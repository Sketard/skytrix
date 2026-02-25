---
type: technical-research
project: skytrix
author: Claude (AI Research Agent)
date: 2026-02-23
subject: YGOPro/OCGCore WASM Compilations & JS/TS Yu-Gi-Oh! Duel Engines
status: complete
---

# Research: OCGCore WASM Ports & Browser-Based Yu-Gi-Oh! Duel Engines

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [OCGCore compiled to WASM](#2-ocgcore-compiled-to-wasm)
3. [Node.js native bindings for OCGCore](#3-nodejs-native-bindings-for-ocgcore)
4. [Full web clients using OCGCore (server or WASM)](#4-full-web-clients-using-ocgcore)
5. [JavaScript/TypeScript duel engine reimplementations](#5-javascripttypescript-duel-engine-reimplementations)
6. [Manual (no rules engine) web simulators](#6-manual-no-rules-engine-web-simulators)
7. [Other language duel engines (compilable to WASM)](#7-other-language-duel-engines)
8. [npm packages in the ecosystem](#8-npm-packages-in-the-ecosystem)
9. [Dead/historical projects](#9-deadhistorical-projects)
10. [Comparative Matrix](#10-comparative-matrix)
11. [Key Takeaways for Skytrix](#11-key-takeaways-for-skytrix)
12. [Sources](#12-sources)

---

## 1. Executive Summary

The landscape of browser-compatible Yu-Gi-Oh! duel engines is surprisingly thin. The critical finding is:

- **One production-quality WASM port exists**: `@n1xx1/ocgcore-wasm` compiles EDOPro's C++ core to WebAssembly via Emscripten. It is published on JSR, works in browsers/Node/Deno, and has a typed TypeScript API. This is the only viable path for running the full OCGCore rules engine in a browser.

- **One production web client exists**: NEOS (`DarkNeos/neos-ts`) is a fully functional React+TypeScript web client for YGOPro that is live at neos.moecube.com. It connects to a server-side duel engine (not client-side WASM).

- **No complete JS/TS reimplementation of the duel engine exists**. All JavaScript "duel engines" found are either very early stage, abandoned, or only implement a tiny fraction of the rules.

- **The Node.js native bindings** (`ghlin/node-ygocore`) are abandoned (last update ~2019).

---

## 2. OCGCore Compiled to WASM

### 2.1 @n1xx1/ocgcore-wasm (THE key project)

| Field | Value |
|---|---|
| **Repository** | [github.com/n1xx1/ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) |
| **Registry** | [jsr.io/@n1xx1/ocgcore-wasm](https://jsr.io/@n1xx1/ocgcore-wasm) |
| **Language** | TypeScript (95%), C++ (2.3%), Shell (2.2%) |
| **License** | MIT |
| **Stars** | 5 |
| **Forks** | 2 |
| **Commits** | 102 |
| **Latest version** | 0.1.1 (published ~May 2025, i.e. ~9 months ago) |
| **Total releases** | 15 (from 0.0.21 to 0.1.1) |
| **Weekly downloads** | 11 |
| **JSR Score** | 94% |
| **Status** | **Active but low-traffic** — maintenance phase, not abandoned |

**How it works:**
- Compiles ProjectIgnis' EDOPro fork of `ygopro-core` (C++17 + embedded Lua) to WebAssembly using **Emscripten**
- Produces a `.wasm` binary + JS glue code
- Wraps the raw C API (`OCG_CreateDuel`, `OCG_DuelProcess`, etc.) in a **typed TypeScript API**
- Zero npm dependencies
- Build uses pnpm + Docker for reproducible Emscripten compilation

**Platform support:**
- Node.js: YES
- Deno: YES
- Browsers: YES
- Bun: Unknown
- Cloudflare Workers: Unknown

**API surface (TypeScript):**
```typescript
createCore()             // Initialize engine (sync or async)
createDuel(options)      // Set up duel with rules, LP, seeds, callbacks
duelProcess()            // Advance state machine
duelGetMessage()         // Read game state messages
duelSetResponse()        // Submit player choices
```

**Callbacks provided by host:**
- `cardReader`: provide card data (from DB or in-memory)
- `scriptReader`: provide Lua script source for a given card code
- `errorHandler`: handle Lua/engine errors

**Async mode:**
The async version uses JS Promise Integration (JSPI) and type reflection. Node.js requires `--experimental-wasm-stack-switching` flag. This is needed because the OCGCore C++ code uses Lua coroutines which map to WASM stack switching for async callbacks.

**Key implications for Skytrix:**
- This package is the **only** browser-compatible way to run the full OCGCore rules engine client-side
- You would need to also bundle or lazy-load ~13,000+ Lua card scripts
- The card database (cards.cdb) data would need to be served to the `cardReader` callback
- WASM bundle size estimated at ~2-5 MB
- MIT license is very permissive (unlike the AGPL core source itself)

---

## 3. Node.js Native Bindings for OCGCore

### 3.1 node-ygocore (ghlin)

| Field | Value |
|---|---|
| **Repository** | [github.com/ghlin/node-ygocore](https://github.com/ghlin/node-ygocore) |
| **npm package** | [ygocore](https://www.npmjs.com/package/ygocore) (v0.3.4) |
| **Language** | C++ (84.1%), C (15.5%) |
| **License** | MIT |
| **Stars** | ~5 |
| **Commits** | 50 |
| **Last npm publish** | ~2020 (5+ years ago) |
| **Weekly downloads** | 94 |
| **Status** | **Abandoned / Inactive** |

**How it works:**
- Native Node.js addon via `node-gyp`
- Compiles the moecube fork of `ygopro-core` as a native C++ addon
- Exposes duel creation, card management, turn processing to JS
- Requires companion package `ygocore-interface` for message deserialization

**Why it matters less now:**
- Native addons don't run in browsers
- The moecube fork is older than the edo9300/EDOPro fork
- No updates in 5+ years — likely broken with modern Node.js versions
- Superseded by `@n1xx1/ocgcore-wasm` for all practical purposes

### 3.2 ygocore-interface

| Field | Value |
|---|---|
| **npm package** | [ygocore-interface](https://www.npmjs.com/package/ygocore-interface) (v0.3.2) |
| **Last publish** | ~2018 (7+ years ago) |
| **Status** | **Abandoned** |

Companion message deserialization library for `node-ygocore`. Parses binary OCGCore messages into JS objects.

---

## 4. Full Web Clients Using OCGCore

### 4.1 NEOS (DarkNeos/neos-ts) — THE production web client

| Field | Value |
|---|---|
| **Repository** | [github.com/DarkNeos/neos-ts](https://github.com/DarkNeos/neos-ts) |
| **Live URL** | [neos.moecube.com](https://neos.moecube.com) / [neos.moe](https://www.neos.moe) |
| **Language** | TypeScript (97.2%), SCSS (2.8%) |
| **Framework** | React 18 + Vite + Valtio (state management) |
| **License** | GPL-3.0 |
| **Stars** | ~50+ |
| **Commits** | 2,012 |
| **Status** | **Active — public beta, live in production** |

**How it works:**
- NEOS is described as "web version of Yu-Gi-Oh! Game written in TypeScript, React.js and WebAssembly"
- It is a **web client** that connects to a **server-side duel engine** (Koishi 7210 server / MyCard infrastructure)
- The duel engine runs server-side (not in the browser) — the WASM mention likely refers to some client-side processing or protocol handling
- Uses Protocol Buffers (neos-protobuf submodule) for client-server communication
- Part of the MyCard community ecosystem

**Features:**
- Ranked competitive matches (MyCard Ladder)
- Casual duels
- Single-player AI mode
- Custom rooms for friend battles
- Replay system
- Live match observation

**Key implication for Skytrix:**
- Proves a web-based YGOPro client is viable
- But relies on server-side infrastructure for the duel engine
- GPL-3.0 license restricts code reuse
- Demonstrates the React+TypeScript UI approach works

### 4.2 SRVPro (mycard/srvpro)

| Field | Value |
|---|---|
| **Repository** | [github.com/mycard/srvpro](https://github.com/mycard/srvpro) |
| **Language** | CoffeeScript (42%), JavaScript (38%), TypeScript (20%) |
| **License** | AGPL-3.0 |
| **Stars** | 202 |
| **Forks** | 89 |
| **Commits** | 1,272 |
| **Status** | **Active** — powers MyCard, YGOPro 233, KoishiPro |

**How it works:**
- Server-side orchestration layer for YGOPro duels
- Wraps OCGCore as a subprocess (compiled natively, not WASM)
- Provides matchmaking, tournament mode, WindBot AI integration, replay recording
- Node.js + Docker
- The backend that NEOS connects to

---

## 5. JavaScript/TypeScript Duel Engine Reimplementations

### 5.1 yugioh_web (rickypeng99)

| Field | Value |
|---|---|
| **Repository** | [github.com/rickypeng99/yugioh_web](https://github.com/rickypeng99/yugioh_web) |
| **Language** | JavaScript (92.1%), CSS (7.3%) |
| **Framework** | React 18 + Redux + Material-UI + Socket.io |
| **License** | MIT |
| **Stars** | 112 |
| **Forks** | 41 |
| **Commits** | 65 |
| **Status** | **Semi-active** — last dependency update Feb 2023 |

**How it works:**
- **Full reimplementation** in JavaScript — does NOT use OCGCore or Lua scripts
- Custom game engine written entirely in JS
- Multiplayer via WebSocket (Socket.io)
- Desktop version via Electron branch

**Implemented features:**
- Normal, set, and tribute summons
- Phase system between players
- Battle system with animations
- Life points tracking
- Effect activation and chaining logic
- Card detail viewer

**What's missing:**
- Large percentage of card effects (no Lua script library = limited card pool)
- Advanced mechanics (XYZ materials, Pendulum, Link arrows, etc.)
- Server deployment not maintained

**Key implication:** Shows that building a JS duel engine is possible for basic rules, but the card effect coverage will always be orders of magnitude behind OCGCore's 13,000+ scripted cards.

### 5.2 duel-engine (donaldnevermore)

| Field | Value |
|---|---|
| **Repository** | [github.com/donaldnevermore/duel-engine](https://github.com/donaldnevermore/duel-engine) |
| **Language** | TypeScript (89.1%), CSS (9.2%) |
| **Build** | Webpack + Electron Forge |
| **Testing** | Jest |
| **License** | Apache-2.0 |
| **Stars** | 1 |
| **Commits** | 28 |
| **Status** | **Very early stage / likely abandoned** |

**How it works:**
- Full reimplementation in TypeScript
- Standalone Electron app
- No connection to OCGCore at all

**Implemented:**
- Initial game preparation
- Monster summoning
- Monster attack
- Turn-based system

**Not implemented:**
- Monster effects, spells, traps
- Field zones, graveyard
- Draw mechanics, deck management
- Chain resolution

**Assessment:** Proof of concept only. Not usable for any real simulation.

### 5.3 iygo (lucaskienast)

| Field | Value |
|---|---|
| **Repository** | [github.com/lucaskienast/iygo](https://github.com/lucaskienast/iygo) |
| **Language** | JavaScript (93.4%) |
| **Stack** | MERN (MongoDB, Express, React, Node.js) |
| **Stars** | 1 |
| **Commits** | 153 |
| **Status** | **Active prototype — v1.0 (deck builder only)** |

**Assessment:** No duel engine at all. This is a card library + deck builder. PvP/duel features are listed as v2 roadmap. Not relevant as a duel engine.

---

## 6. Manual (No Rules Engine) Web Simulators

These projects provide a virtual tabletop for Yu-Gi-Oh! but do NOT automate rules enforcement. They are comparable to Skytrix's current manual simulator.

### 6.1 Duelingbook (duelingbook.com)

| Field | Value |
|---|---|
| **URL** | [duelingbook.com](https://www.duelingbook.com) |
| **Type** | Proprietary web app |
| **Approach** | ~99% manual — very little automated rule enforcement |
| **Status** | **Active, widely used** |

The dominant browser-based manual YGO simulator. Closed source. Designed to replicate the experience of playing at a real table, with both players responsible for knowing the rules.

### 6.2 YGOSiM (stevoduhhero)

| Field | Value |
|---|---|
| **Repository** | [github.com/stevoduhhero/YGOSiM-archive](https://github.com/stevoduhhero/YGOSiM-archive) |
| **Language** | JavaScript (86%) |
| **Stack** | Node.js + Grunt build |
| **Status** | **Archived / Abandoned** |

Manual web simulator with basic card manipulation. No rules engine.

### 6.3 yugioh-webmat (leongersen)

| Field | Value |
|---|---|
| **Repository** | [github.com/leongersen/yugioh-webmat](https://github.com/leongersen/yugioh-webmat) |
| **Language** | JavaScript (78%), CSS, PHP |
| **Approach** | WebRTC P2P card sync, no rules engine |
| **Stars** | 0 |
| **Last activity** | 2015 |
| **Status** | **Abandoned** |

Minimal playing field syncing card positions between two players via WebRTC. No rule enforcement.

### 6.4 arthastheking113/yugioh-simulator

| Field | Value |
|---|---|
| **Repository** | [github.com/arthastheking113/yugioh-simulator](https://github.com/arthastheking113/yugioh-simulator) |
| **Language** | HTML/CSS/JS (vanilla) |
| **Status** | **Simple demo project** |

Simple HTML/CSS/JS simulator. No npm, no build tools, no rules engine. Educational project from Vietnam.

### 6.5 yugioh-sim (kanetempleton)

| Field | Value |
|---|---|
| **Repository** | [github.com/kanetempleton/yugioh-sim](https://github.com/kanetempleton/yugioh-sim) |
| **Language** | Go (42.3%), JavaScript (38.9%) |
| **Stack** | Go backend + MySQL + JS frontend |
| **Status** | **Educational project, incomplete** |

Manual simulator with custom card image uploads. Players execute actions manually (draw, play, flip, move to graveyard). No automated rules.

---

## 7. Other Language Duel Engines (Potentially Compilable to WASM)

### 7.1 Ptival/yugioh (Haskell)

| Field | Value |
|---|---|
| **Repository** | [github.com/Ptival/yugioh](https://github.com/Ptival/yugioh) |
| **Language** | Haskell (89.3%), Nix (10.7%) |
| **License** | GPL-3.0 |
| **Stars** | 11 |
| **Commits** | 18 |
| **Status** | **Very early / Template project** |

Haskell YGO simulator. Barely started — README shows placeholder template values. Not usable.

### 7.2 ygo-emu-poc (CatchABus)

| Field | Value |
|---|---|
| **Repository** | [github.com/CatchABus/ygo-emu-poc](https://github.com/CatchABus/ygo-emu-poc) |
| **Language** | TypeScript (98%) |
| **Stack** | Nx monorepo, Vite, Node.js v20.6+ |
| **License** | MIT |
| **Stars** | 2 |
| **Commits** | 50 |
| **Status** | **Active PoC** |

Browser port of the YGO: Power of Chaos game series (2003-2004 era). Aims to replicate the original single-player gameplay with online multiplayer additions. Uses card images from YGOPRODeck API. The card pool and rules are limited to the original Power of Chaos games (a tiny subset of modern Yu-Gi-Oh).

---

## 8. npm Packages in the Ecosystem

### Card data packages (not duel engines, but useful)

| Package | Description | Status |
|---|---|---|
| [`ygopro-data`](https://www.npmjs.com/package/ygopro-data) | Parse YGOPro CDB card databases | Maintained |
| [`yugioh-deck-tool`](https://github.com/FelixRilling/yugioh-deck-tool) | Deck sharing/editing, price lookup (uses ygoprodeck API) | Maintained |

### Duel engine packages

| Package | Description | Status |
|---|---|---|
| [`@n1xx1/ocgcore-wasm`](https://jsr.io/@n1xx1/ocgcore-wasm) | OCGCore compiled to WASM (JSR, not npm) | Active |
| [`ygocore`](https://www.npmjs.com/package/ygocore) | Native Node.js bindings for ygopro-core | **Dead** (5+ years) |
| [`ygocore-interface`](https://www.npmjs.com/package/ygocore-interface) | Message parser for ygocore | **Dead** (7+ years) |

---

## 9. Dead/Historical Projects

### 9.1 YgoChrome

| Field | Value |
|---|---|
| **Announcement** | [ygopro.co news post](https://www.ygopro.co/news/tabid/89/entryid/1119/-introducing-ygochrome-play-ygopro-in-a-web-browser.aspx) |
| **Technology** | PNaCl (Portable Native Client) — Chrome-only |
| **Status** | **Dead** — PNaCl deprecated by Chrome in 2017 in favor of WebAssembly |

The first attempt to run YGOPro in a browser. Used Google's PNaCl technology to run native C++ code in Chrome. Died when Chrome removed PNaCl support. This is the precursor to the WASM approach.

### 9.2 DevPro-browser (Zayelion)

| Field | Value |
|---|---|
| **Repository** | [github.com/Zayelion/DevPro-browser](https://github.com/Zayelion/DevPro-browser) |
| **Language** | JavaScript (61%), CSS (39%) |
| **Stars** | 0 |
| **Commits** | 47 |
| **Created** | 2013 |
| **Status** | **Dead** |

Early experimental web interface for DevPro. Used **ASM.js** (pre-WASM) methods to emulate OCGCore API with virtual memory arrays. WebSocket tunneling to connect to DevPro's TCP-based servers. Pioneering but never completed.

### 9.3 YGOPro-Library-Builder (Zayelion)

| Field | Value |
|---|---|
| **Repository** | [github.com/Zayelion/YGOPro-Library-Builder](https://github.com/Zayelion/YGOPro-Library-Builder) |
| **Purpose** | Build ocgcore.dll for server-side use |
| **Status** | **Obsolete** — superseded by modern build systems |

Helper tool to compile ygopro-core into a DLL for Node.js server integration. Part of the YGOSalvation ecosystem.

### 9.4 YGOSalvation-Server (SalvationDevelopment)

| Field | Value |
|---|---|
| **Repository** | [github.com/SalvationDevelopment/YGOSalvation-Server](https://github.com/SalvationDevelopment/YGOSalvation-Server) |
| **Language** | JavaScript (95.8%), Node.js + MongoDB |
| **License** | **Proprietary** (no use without permission, max 10 users) |
| **Stars** | 23 |
| **Forks** | 19 |
| **Commits** | 14,404 |
| **Last release** | v4.5.0 (January 2016) |
| **Status** | **Stale** — issues still open, but no meaningful updates |

Server/launcher/management system for YGOPro. Uses native ocgcore as a subprocess. Node.js web interface. Restrictive license makes it unusable for other projects.

### 9.5 jiayihu/ygo (PWA Card Viewer)

| Field | Value |
|---|---|
| **Repository** | [github.com/jiayihu/ygo](https://github.com/jiayihu/ygo) |
| **Language** | CSS (53%), TypeScript (43%) |
| **Stack** | Web Components + HyperHTML + Bulma + Workbox |
| **License** | MIT |
| **Stars** | 6 |
| **Status** | Active |

**Not a duel engine.** This is a card database PWA (Progressive Web App) for browsing Yu-Gi-Oh! card information. Included here for completeness since it appeared in searches.

---

## 10. Comparative Matrix

### Projects with actual duel engine logic

| Project | Engine type | Rules completeness | Browser-compatible | Active | License | Stars |
|---|---|---|---|---|---|---|
| **@n1xx1/ocgcore-wasm** | OCGCore C++ -> WASM | 100% (all 13k+ cards) | YES (WASM) | Yes (maintenance) | MIT | 5 |
| **NEOS (neos-ts)** | Server-side OCGCore | 100% (all cards) | YES (web client) | Yes (production) | GPL-3.0 | ~50 |
| **SRVPro** | Server-side OCGCore | 100% (all cards) | Server only | Yes | AGPL-3.0 | 202 |
| **yugioh_web** | Custom JS reimpl. | ~5% (basic rules only) | YES (pure JS) | Semi-active | MIT | 112 |
| **duel-engine** | Custom TS reimpl. | ~1% (skeleton) | Electron only | Dead | Apache-2.0 | 1 |
| **node-ygocore** | OCGCore native addon | 100% (all cards) | NO (native only) | Dead | MIT | ~5 |

### Manual simulators (no rules engine)

| Project | Approach | Browser | Active | License |
|---|---|---|---|---|
| **Duelingbook** | Proprietary web | YES | Yes | Proprietary |
| **YGOSiM** | Node.js web app | YES | Dead | Unknown |
| **yugioh-webmat** | WebRTC P2P | YES | Dead | Unknown |
| **yugioh-sim** | Go + JS | YES | Educational | Unknown |

---

## 11. Key Takeaways for Skytrix

### Finding 1: @n1xx1/ocgcore-wasm is the critical discovery

This is the **only** project that compiles the full OCGCore to WASM for browser use. It changes the feasibility analysis from the previous research document:

- **Option A (WASM in browser)** is now significantly more viable because someone has already done the hard work of Emscripten compilation and TypeScript wrapping
- You would NOT need to set up the Emscripten toolchain yourself for initial exploration — just `import` the JSR package
- The MIT license on the wrapper is permissive (though the underlying EDOPro core source is AGPL-3.0)

### Finding 2: No viable JS/TS duel engine reimplementation exists

Every attempt to reimplement the duel engine in JavaScript or TypeScript has stalled at <5% completeness. The `yugioh_web` project (112 stars, the most popular attempt) only handles basic summoning and combat. This confirms that **Option C (TS reimplementation) from the previous research is not viable** — nobody has succeeded at it.

### Finding 3: NEOS proves the web client approach works

NEOS is a production React+TypeScript web client for YGOPro. This proves:
- Full YGOPro gameplay can be rendered in a modern web UI
- React (and by extension Angular) is a viable framework choice
- The Protocol Buffer / message-based architecture works for client-server communication

### Finding 4: The two realistic paths are now clear

1. **Client-side WASM (using @n1xx1/ocgcore-wasm)**: Run the full engine in the browser. Zero server needed for duel logic. Need to solve Lua script loading and card data provisioning.

2. **Server-side with web client (like NEOS/SRVPro)**: Run OCGCore on a server, build a web client that communicates via WebSocket. Proven architecture, but requires server infrastructure.

### Finding 5: License landscape

| Package/Project | License | Implication |
|---|---|---|
| @n1xx1/ocgcore-wasm (wrapper) | MIT | Free to use |
| edo9300/ygopro-core (source) | AGPL-3.0 | Copyleft: if you modify & distribute, source must be open |
| ProjectIgnis CardScripts (Lua) | Unlicensed (community) | Gray area |
| NEOS | GPL-3.0 | Cannot use code in proprietary projects |
| SRVPro | AGPL-3.0 | Network use = distribution |
| yugioh_web | MIT | Free to use |

---

## 12. Sources

### WASM / Core Engine
- [n1xx1/ocgcore-wasm (GitHub)](https://github.com/n1xx1/ocgcore-wasm)
- [@n1xx1/ocgcore-wasm (JSR)](https://jsr.io/@n1xx1/ocgcore-wasm)
- [@n1xx1/ocgcore-wasm versions (JSR)](https://jsr.io/@n1xx1/ocgcore-wasm/versions)
- [edo9300/ygopro-core (GitHub)](https://github.com/edo9300/ygopro-core)
- [edo9300/edopro (GitHub)](https://github.com/edo9300/edopro)
- [Fluorohydride/ygopro-core (GitHub)](https://github.com/Fluorohydride/ygopro-core)

### Web Clients
- [DarkNeos/neos-ts (GitHub)](https://github.com/DarkNeos/neos-ts)
- [NEOS live (moecube)](https://neos.moecube.com/)
- [mycard/srvpro (GitHub)](https://github.com/mycard/srvpro)

### JS/TS Duel Engines
- [rickypeng99/yugioh_web (GitHub)](https://github.com/rickypeng99/yugioh_web)
- [donaldnevermore/duel-engine (GitHub)](https://github.com/donaldnevermore/duel-engine)
- [lucaskienast/iygo (GitHub)](https://github.com/lucaskienast/iygo)

### Node.js Bindings
- [ghlin/node-ygocore (GitHub)](https://github.com/ghlin/node-ygocore)
- [ygocore (npm)](https://www.npmjs.com/package/ygocore)
- [ygocore-interface (npm)](https://www.npmjs.com/package/ygocore-interface)

### Manual Simulators
- [Duelingbook](https://www.duelingbook.com/)
- [stevoduhhero/YGOSiM-archive (GitHub)](https://github.com/stevoduhhero/YGOSiM-archive)
- [leongersen/yugioh-webmat (GitHub)](https://github.com/leongersen/yugioh-webmat)
- [kanetempleton/yugioh-sim (GitHub)](https://github.com/kanetempleton/yugioh-sim)
- [arthastheking113/yugioh-simulator (GitHub)](https://github.com/arthastheking113/yugioh-simulator)

### Other
- [CatchABus/ygo-emu-poc (GitHub)](https://github.com/CatchABus/ygo-emu-poc)
- [Ptival/yugioh (GitHub)](https://github.com/Ptival/yugioh)
- [jiayihu/ygo (GitHub)](https://github.com/jiayihu/ygo)
- [Zayelion/DevPro-browser (GitHub)](https://github.com/Zayelion/DevPro-browser)
- [SalvationDevelopment/YGOSalvation-Server (GitHub)](https://github.com/SalvationDevelopment/YGOSalvation-Server)
- [YgoChrome announcement (ygopro.co)](https://www.ygopro.co/news/tabid/89/entryid/1119/-introducing-ygochrome-play-ygopro-in-a-web-browser.aspx)
- [PNaCl deprecation (Chromium Blog)](https://blog.chromium.org/2017/05/goodbye-pnacl-hello-webassembly.html)
- [ygopro-data (npm)](https://www.npmjs.com/package/ygopro-data)
- [yugioh-deck-tool (GitHub)](https://github.com/FelixRilling/yugioh-deck-tool)
