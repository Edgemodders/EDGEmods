#!/usr/bin/env node
// Runs the EDGEmods website. Settings come from the environment; see packages/server/src/config.ts.
//
//   EDGEMODS_DATA=data EDGEMODS_SHOW_UNCHECKED=1 node packages/server/bin/edgemods-server.mjs
import { loadConfig, startServer } from '../dist/index.js';

const config = loadConfig();
try {
  const { server, close } = await startServer(config);
  const address = server.address();
  console.log(`EDGEmods on http://${typeof address === 'object' && address ? `${address.address}:${address.port}` : config.host}, index ${config.indexPath}`);
  if (config.showUnchecked) console.log('Showing releases that have not passed the release checks (EDGEMODS_SHOW_UNCHECKED=1): for a developer\'s PC only.');
  const stop = (signal) => {
    console.log(`${signal}: closing`);
    close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
} catch (err) {
  console.error(`EDGEmods could not start: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
