#!/usr/bin/env node
// Runs the EDGEmods website. Settings come from the environment; see packages/server/src/config.ts. On a PC they
// can sit in a .env file in the folder it is started from (the checkout's top), which git ignores; set
// EDGEMODS_ENV_FILE to read another. Settings already in the environment win over the file.
//
//   EDGEMODS_DATA=data EDGEMODS_SHOW_UNCHECKED=1 node packages/server/bin/edgemods-server.mjs
import { existsSync } from 'node:fs';
import { loadConfig, startServer } from '../dist/index.js';

const envFile = process.env.EDGEMODS_ENV_FILE ?? '.env';
if (existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  Object.assign(process.env, before);
  console.log(`Settings read from ${envFile}`);
}

const config = loadConfig();
try {
  const { server, close } = await startServer(config);
  const address = server.address();
  console.log(`EDGEmods on http://${typeof address === 'object' && address ? `${address.address}:${address.port}` : config.host}, index ${config.indexPath}`);
  if (config.showUnchecked) console.log('Showing releases that have not passed the release checks (EDGEMODS_SHOW_UNCHECKED=1): for a developer\'s PC only.');
  console.log(config.auth ? `Sign-in: on, with ${config.auth.domain}; come back to ${config.publicUrl}/auth/callback. Admins: ${config.admins.length}.` : 'Sign-in: off.');
  for (const problem of config.authProblems) console.log(`  ${problem}`);
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
