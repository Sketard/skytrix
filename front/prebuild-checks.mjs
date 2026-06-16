#!/usr/bin/env node
// Front prebuild gate — runs the repo-root parity checks before `ng build`.
//
// These checks (ws-protocol-sync, perspective-isolation, animation-parity)
// live at the repo root in `scripts/`. They run fine for `npm run build`
// invoked from a full checkout (CI, dev local) where `../scripts/` exists.
//
// The front Docker build, however, uses `front/` as its build context
// (`build: ./front` in docker-compose.yml), so `../scripts/` is NOT present
// in the image. This is by design — the parity gates are dev/CI guards, not
// a requirement to produce the bundle, and GitHub Actions (protocol-sync.yml)
// already enforces them on every push. So we skip cleanly when the root
// scripts are absent instead of failing the Docker build.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const scriptsDir = resolve(here, '..', 'scripts');

const CHECKS = [
  'check-ws-protocol-sync.mjs',
  'check-perspective-isolation.mjs',
  'check-animation-parity.mjs',
];

if (!existsSync(scriptsDir)) {
  console.log(
    '[prebuild] repo-root scripts/ not found (Docker build context) — ' +
      'skipping parity checks; CI enforces them on push.',
  );
  process.exit(0);
}

for (const check of CHECKS) {
  const checkPath = resolve(scriptsDir, check);
  const result = spawnSync(process.execPath, [checkPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
