// Starts the service: opens site.db (creating it) and index.db, and listens. SIGHUP reloads index.db, so a new
// index can be swapped in without a restart; SIGTERM closes cleanly (systemd stops services with it).

import type { Server } from 'node:http';
import { join } from 'node:path';
import { Accounts } from './accounts.js';
import { createApp } from './app.js';
import { Auth0 } from './auth0.js';
import { Catalog } from './catalog.js';
import type { Config } from './config.js';
import { ImageCache } from './images.js';
import { SiteStore } from './site-store.js';

export async function startServer(config: Config): Promise<{ server: Server; close: () => Promise<void> }> {
  const site = new SiteStore(join(config.dataDir, 'site.db'));
  const catalog = new Catalog(config.indexPath, site.path, { showUnchecked: config.showUnchecked });
  const images = new ImageCache(join(config.dataDir, 'images'));
  const auth0 = config.auth && new Auth0(config.auth, `${config.publicUrl}/auth/callback`);
  const accounts = new Accounts(config, site, auth0);
  const app = createApp({ config, catalog, site, images, accounts });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(config.port, config.host, () => resolve(s));
    s.once('error', reject);
  });
  const close = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    catalog.close();
    site.close();
  };
  return { server, close };
}
