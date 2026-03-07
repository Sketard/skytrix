#!/usr/bin/env node
// Verify ws-protocol types stay in sync between duel-server and Angular front-end.
// Cross-platform replacement for check-ws-protocol-sync.sh

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const source = resolve(root, 'duel-server/src/ws-protocol.ts');
const copy = resolve(root, 'front/src/app/pages/pvp/duel-ws.types.ts');

const sourceContent = readFileSync(source, 'utf-8');
const copyContent = readFileSync(copy, 'utf-8');

if (sourceContent !== copyContent) {
  console.error('ERROR: ws-protocol files are out of sync!');
  console.error('  Source: duel-server/src/ws-protocol.ts');
  console.error('  Copy:   front/src/app/pages/pvp/duel-ws.types.ts');
  process.exit(1);
}

console.log('OK: ws-protocol files are in sync.');
