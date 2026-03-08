# OCGCore WASM — Custom Build Guide

## Context

Skytrix uses `@n1xx1/ocgcore-wasm@0.1.1` (published on JSR) as the duel engine.
This package is a pre-built WASM compilation of **edo9300/ygopro-core** (the EDOPro C++ engine).

**Problem:** The WASM build (v0.1.1, May 2025) was compiled from an OCGCore commit
that predates `Duel.GetReasonPlayer` and `Duel.GetReasonEffect` — both added to
ygopro-core on **May 29, 2025** (commit `0b31b9b`), the same day as the last
ocgcore-wasm release. The Lua scripts (EDOPro community scripts) evolve faster
than the WASM build and now depend on these missing functions.

**Current workaround:** Guards in `proc_workaround.lua` that fallback when
`Duel.GetReasonPlayer` is nil. This holds but is fragile — any new missing
function will cause the same silent failures (effects resolving without costs).

## Architecture of n1xx1/ocgcore-wasm

```
n1xx1/ocgcore-wasm/
├── cpp/
│   ├── lua/          ← Git submodule: lua/lua (branch v5.3)
│   └── ygo/          ← Git submodule: edo9300/ygopro-core (branch master)
├── scripts/          ← Emscripten build scripts (shell)
├── src/              ← TypeScript bindings (message parsing, response serialization, etc.)
├── lib/              ← Compiled WASM output (sync + async/JSPI variants)
├── dist/             ← Bundled JS + .d.ts (esbuild output)
├── package.json      ← Build scripts: build:emscripten, build:lib, build:types
├── .gitmodules       ← Submodule definitions
└── mod.ts            ← Package entrypoint
```

**Build pipeline:**
1. `build:emscripten` — Compiles `cpp/ygo/` + `cpp/lua/` → WASM via Emscripten (shell script in `scripts/`)
2. `build:lib` — Processes WASM output into importable JS modules (sync + async variants)
3. `build:types` — Generates `.d.ts` from TypeScript source via API Extractor

**Output:** Two WASM variants:
- `ocgcore.sync.wasm` + `.mjs` — Synchronous (what we use via `createCore({ sync: true })`)
- `ocgcore.jspi.wasm` + `.mjs` — Async with JS Promise Integration

## Step-by-step: Fork & Rebuild

### Prerequisites

- **Git** (with submodule support)
- **Emscripten SDK (emsdk)** — install from https://emscripten.org/docs/getting_started/downloads.html
- **Node.js 18+** and **pnpm**
- ~2-3 GB disk space for emsdk + build artifacts

### 1. Fork the repository

```bash
# Fork on GitHub: https://github.com/n1xx1/ocgcore-wasm → your-username/ocgcore-wasm
git clone --recursive https://github.com/your-username/ocgcore-wasm.git
cd ocgcore-wasm
```

The `--recursive` flag clones the two submodules (`cpp/lua` and `cpp/ygo`).

### 2. Update OCGCore submodule to latest

```bash
cd cpp/ygo
git fetch origin master
git checkout origin/master   # or a specific commit
cd ../..
```

**Minimum required commit:** `0b31b9b` (May 29, 2025) — adds `Duel.GetReasonPlayer`
and `Duel.GetReasonEffect`.

**Recommended:** Use the latest `master` to get all recent card mechanic fixes.

### 3. Check for breaking API changes

Compare the C++ API between the old and new OCGCore versions:

```bash
cd cpp/ygo
git diff <old-commit>..<new-commit> -- ocgapi.h
git diff <old-commit>..<new-commit> -- interpreter.h
git log --oneline <old-commit>..HEAD
```

Look for:
- New/changed function signatures in `ocgapi.h` (the WASM bindings wrap these)
- New Lua API functions (added via `interpreter_duel*.cpp`) — these need TypeScript type definitions
- Changed enum values or struct layouts

### 4. Install Emscripten

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh   # Linux/Mac — sets PATH for emcc
cd ..
```

On Windows, use `emsdk.bat` and `emsdk_env.bat` instead.

### 5. Install dependencies & build

```bash
pnpm install
pnpm run build:emscripten    # C++ → WASM (slow, ~2-5 min)
pnpm run build:lib           # WASM → JS modules
pnpm run build:types         # Generate TypeScript declarations
```

If `build:emscripten` fails:
- Check Emscripten version compatibility (see `scripts/` for expected version)
- Check for new C++ files in `cpp/ygo/` that need to be added to the build list
- Check for C++17/20 features that may need compiler flags

### 6. Run tests

```bash
pnpm run start:tests
```

Tests require Node.js with WASM JSPI support (`--experimental-wasm-jspi`).

### 7. Update TypeScript bindings (if needed)

If OCGCore added new Lua functions or changed message types, update:
- `src/type_message.ts` — New `OcgMessageType` enum values
- `src/type_response.ts` — New `OcgResponseType` values
- `src/messages.ts` — Message deserialization
- `src/responses.ts` — Response serialization

For `GetReasonPlayer` specifically, the function is exposed to Lua by OCGCore's
C++ interpreter — it should work automatically once the submodule is updated,
without TypeScript binding changes (it's a Lua→C++ call, not a JS→WASM call).

### 8. Use in skytrix

**Option A: Local file reference (simplest for dev)**

```bash
# In ocgcore-wasm repo
pnpm pack   # Creates n1xx1-ocgcore-wasm-x.x.x.tgz
```

```jsonc
// duel-server/package.json
{
  "dependencies": {
    "@n1xx1/ocgcore-wasm": "file:../ocgcore-wasm/n1xx1-ocgcore-wasm-0.2.0.tgz"
  }
}
```

**Option B: Publish to JSR under your scope**

```bash
# Update jsr.json with your scope
# jsr.json: { "name": "@your-scope/ocgcore-wasm", "version": "0.2.0", ... }
npx jsr publish
```

**Option C: Git dependency**

```jsonc
// duel-server/package.json
{
  "dependencies": {
    "@n1xx1/ocgcore-wasm": "github:your-username/ocgcore-wasm#main"
  }
}
```

### 9. Remove workarounds

Once the new build is confirmed working:

1. **Remove guards from `proc_workaround.lua`** — revert to original `Duel.GetReasonPlayer()` calls
2. **Remove the import path patch** — `patches/@n1xx1+ocgcore-wasm+0.1.1.patch` (may no longer be needed)
3. **Remove debug logs** from `duel-worker.ts`

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Emscripten version mismatch | Medium | Check `scripts/` for expected emsdk version, pin it |
| New C++ API breaks TS bindings | Medium | Compare `ocgapi.h` diff, update `src/` types if needed |
| WASM binary size increase | Low | Monitor — current is ~2-3 MB, unlikely to grow much |
| Build fails on Windows | Medium | Use WSL2 for the Emscripten build step |
| Regression in duel mechanics | Low | Test with known duel scenarios before deploying |

## Maintenance

After the initial fork, updating OCGCore is a repeatable process:

```bash
cd cpp/ygo && git pull origin master && cd ../..
pnpm run build:emscripten && pnpm run build:lib && pnpm run build:types
pnpm run start:tests
# Update duel-server dependency
```

Frequency: align with EDOPro script updates (monthly or when new cards release).
