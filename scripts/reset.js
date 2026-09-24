#!/usr/bin/env node
/**
 * Clears the loaded extract set and every generated pack. The delivered extracts in
 * Claude_Data/ are untouched; the server reloads them on its next start unless
 * SKIP_BOOTSTRAP_DATA=1.
 *
 * Stop the server first — on Windows a running server holds file handles and the delete
 * silently fails to complete.
 */
import fs from 'node:fs';
import path from 'node:path';

import { DATA_DIR } from '../server/store.js';

for (const name of ['extracts', 'analyses', 'narratives', 'snapshot.json']) {
  const target = path.join(DATA_DIR, name);
  if (!fs.existsSync(target)) continue;
  fs.rmSync(target, { recursive: true, force: true });
  if (fs.existsSync(target)) throw new Error(`could not clear ${target} — is the server still running?`);
  console.log(`cleared ${path.relative(process.cwd(), target)}`);
}
