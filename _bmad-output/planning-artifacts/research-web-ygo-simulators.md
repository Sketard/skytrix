---
type: technical-research
project: skytrix
author: Claude (AI Research Agent)
date: 2026-02-23
subject: Web-Based Yu-Gi-Oh! Simulators & Duel Platforms — Alternatives to OCGCore
status: complete
---

# Technical Research: Web-Based Yu-Gi-Oh! Simulators & Duel Platforms

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Major Active Platforms](#2-major-active-platforms)
   - 2.1 Dueling Nexus
   - 2.2 Duelingbook
   - 2.3 YGO Omega
   - 2.4 NEOS (MyCard / Moecube)
   - 2.5 Master Duel (Konami Official)
   - 2.6 Duel Links (Konami Official)
3. [Open-Source Projects on GitHub](#3-open-source-projects-on-github)
   - 3.1 EDOPro / Project Ignis (Desktop, reference)
   - 3.2 yugioh_web (React + Custom JS Engine)
   - 3.3 YGOSiM (Node.js Manual Simulator)
   - 3.4 yugioh-game (Python Text MUD + OCGCore)
   - 3.5 iygo (MERN Stack)
   - 3.6 free-ygo/yugioh-engine (Java)
   - 3.7 Ptival/yugioh (Haskell)
4. [Server Implementations](#4-server-implementations)
   - 4.1 YGOSharp (C# + OCGCore)
   - 4.2 YGOSalvation-Server (Node.js + OCGCore)
   - 4.3 YgoMaster (C# Master Duel Offline Server)
5. [OCGCore-to-WebAssembly: The Key Bridge](#5-ocgcore-to-webassembly-the-key-bridge)
   - 5.1 @n1xx1/ocgcore-wasm
   - 5.2 NEOS Architecture Pattern
6. [Rust-Based YGO Engines](#6-rust-based-ygo-engines)
7. [YGOPro2 and Web Attempts](#7-ygopro2-and-web-attempts)
8. [Comparison Matrix](#8-comparison-matrix)
9. [Key Takeaways for Skytrix](#9-key-takeaways-for-skytrix)
10. [Sources & References](#10-sources--references)

---

## 1. Executive Summary

This document surveys all known web-based Yu-Gi-Oh! duel simulators and platforms to understand what alternatives exist to embedding OCGCore directly for running Yu-Gi-Oh! duels in a browser. The landscape breaks into four categories:

| Category | Examples | Engine Type |
|----------|----------|-------------|
| **Fully automated, web-based** | Dueling Nexus, NEOS | OCGCore (compiled/ported) or custom |
| **Manual, web-based** | Duelingbook | No rules engine (human-enforced) |
| **Fully automated, desktop** | EDOPro, YGO Omega, Master Duel | OCGCore (C++/Lua) or proprietary |
| **Experimental/partial web** | yugioh_web, YGOSiM, iygo | Custom JS engines (incomplete) |

**Key finding:** There is no mature, open-source, pure-JavaScript/TypeScript Yu-Gi-Oh! rules engine that covers the full cardpool. Every fully automated simulator either uses OCGCore (C++/Lua, ~13,000+ card scripts) or a proprietary engine (Konami, Dueling Nexus). The most promising path for running automated duels in a browser is compiling OCGCore to WebAssembly -- which NEOS and the `@n1xx1/ocgcore-wasm` package have demonstrated is viable.

---

## 2. Major Active Platforms

### 2.1 Dueling Nexus

| Field | Details |
|-------|---------|
| **URL** | https://duelingnexus.com |
| **Type** | Web-based (browser), no download required |
| **Rules Engine** | Fully automated |
| **Engine** | Likely based on or closely related to OCGCore/YGOPro ecosystem. Their GitHub org (github.com/DuelingNexus) hosts `ygopro-scripts` and `ygopro-pre-script` repositories (Lua), and credits OCGCore developers, YGO Sharp developers, and Duelists Unite for card scripts and database. |
| **Tech Stack** | Web frontend (JavaScript); card scripts in Lua (shared from YGOPro ecosystem) |
| **Open Source** | No -- the core platform is proprietary. Only peripheral tools (deck exporters, Discord integration) are open. |
| **Status** | Active. Frequently updated with new cards. Has an AI opponent (Nyx). Reported to sometimes lag behind the current banlist by half a format. |
| **Card Scripts** | Lua-based scripts from the YGOPro ecosystem. New cards added shortly after announcement. |
| **Platforms** | Windows, Mac, Linux, Android, iOS, ChromeOS (all via browser) |
| **Notes** | The only fully automated, zero-download YGO simulator with broad card coverage. Cross-platform by nature of being browser-based. Low hardware requirements. |

### 2.2 Duelingbook

| Field | Details |
|-------|---------|
| **URL** | https://www.duelingbook.com |
| **Type** | Web-based (browser), no download required |
| **Rules Engine** | **Manual** -- almost no automation. 99% of rules enforcement depends on both players knowing how their cards work. |
| **Engine** | No duel engine. The platform provides a digital tabletop: drag cards, declare phases, manage LP manually. Some QoL features (shuffling, searching) are assisted. |
| **Tech Stack** | Web frontend (JavaScript/HTML). Custom browser extension ("Dueling Book Unlock") exists for additional features. |
| **Open Source** | No -- proprietary. A third-party `custom-duelingbook` repo exists (github.com/killburne/custom-duelingbook) for UI tweaks. |
| **Status** | Active. Very popular in the competitive community -- preferred for tournament practice because it mirrors physical play. |
| **Card Scripts** | None -- cards are visual representations only. Players must know and apply effects manually. |
| **Platforms** | Browser-only |
| **Notes** | Favored by competitive players and tournament organizers. No cheating prevention through rules enforcement -- relies on player honesty and judge calls. If you can handle the game here, you are set for in-person play. |

### 2.3 YGO Omega

| Field | Details |
|-------|---------|
| **URL** | https://omega.duelistsunite.org |
| **Repository** | https://github.com/duelists-unite/YGOPro2 (Unity-based) |
| **Type** | Desktop application (Windows, Mac, Linux) -- **not web-based** |
| **Rules Engine** | Fully automated (also has manual mode) |
| **Engine** | OCGCore (C++/Lua) -- same core as EDOPro. The Unity client wraps OCGCore. |
| **Tech Stack** | Unity Engine (C#) for client; OCGCore (C++) for duel logic; Lua for card scripts |
| **Open Source** | Partially -- the YGOPro2 Unity client is on GitHub. OCGCore itself is open (see EDOPro). Bot development uses C#. |
| **Status** | Active. Maintained by Duelists Unite (~151,000 Discord members). Supports Swiss tournaments, ranking, AI bots, replays. |
| **Card Scripts** | Lua scripts from the Project Ignis/EDOPro ecosystem |
| **Platforms** | Windows, Mac, Linux (desktop only). No browser version. |
| **Notes** | Visually the most polished fan simulator (3D interactive field, customizable backgrounds). Supports both automatic and manual modes. No web/browser version exists. |

### 2.4 NEOS (MyCard / Moecube)

| Field | Details |
|-------|---------|
| **URL** | https://neos.moecube.com / https://neos.moe |
| **Repository** | https://github.com/DarkNeos/neos-ts (GitHub mirror); primary dev on GitLab: code.moenext.com/mycard/Neos |
| **Type** | **Web-based** (browser) -- fully runs in-browser |
| **Rules Engine** | Fully automated |
| **Engine** | **OCGCore compiled to WebAssembly via Emscripten**. This is the critical architectural detail: the C++ OCGCore engine is compiled to WASM and runs client-side in the browser. |
| **Tech Stack** | TypeScript (97.2%), React 18, Valtio (state management), Vite (build), WebAssembly (OCGCore), SCSS |
| **Open Source** | Yes -- open source. GitHub mirror + GitLab primary. |
| **Status** | Active, in public beta. 2,012+ commits. Integrated with MyCard community ecosystem. Supports ranked ladder, AI duels, custom rooms, replays, spectating. |
| **Card Scripts** | Lua scripts (from YGOPro/EDOPro ecosystem), loaded by the WASM-compiled OCGCore |
| **Platforms** | Browser (cross-platform) |
| **Notes** | **This is the most relevant reference architecture for Skytrix.** It demonstrates that OCGCore can run in a browser via WASM. The TypeScript/React frontend communicates with the WASM OCGCore module for duel simulation. The MyCard community (primarily Chinese-language) maintains the server infrastructure. |

### 2.5 Master Duel (Konami Official)

| Field | Details |
|-------|---------|
| **URL** | https://www.konami.com/yugioh/masterduel |
| **Type** | Native application (PC, consoles, mobile) -- **not web-based** |
| **Rules Engine** | Fully automated |
| **Engine** | **Proprietary Konami engine**. Completely independent from OCGCore. Konami implements card effects using their own internal system. Card text uses Problem-Solving Card Text (PSCT) conventions with semicolons (`;`) for costs/conditions and colons (`:`) for trigger effects. |
| **Tech Stack** | Unity Engine 2020.3.46f1. Uses Scriptable Render Pipeline (SRP). Initially prototyped with Unity due to Duel Links experience, then went through a full engine selection process for cross-platform support. |
| **Open Source** | No -- fully proprietary. |
| **Status** | Active. Konami's flagship digital product. Regular updates with new card packs, events, banlist changes. |
| **Card Scripts** | Proprietary internal format. Not accessible or documented publicly. |
| **Platforms** | Windows (Steam), PlayStation 4/5, Xbox One/Series X|S, Nintendo Switch, iOS, Android |
| **Notes** | The only "official" digital Yu-Gi-Oh! with Master Rule support. Free-to-play with gacha monetization. Has a reverse-engineered offline server: YgoMaster (see Section 4.3). |

### 2.6 Duel Links (Konami Official)

| Field | Details |
|-------|---------|
| **URL** | https://www.konami.com/yugioh/duel_links |
| **Type** | Native application (mobile + PC via Steam) -- **no web/browser version** |
| **Rules Engine** | Fully automated |
| **Engine** | Proprietary Konami engine (same lineage as Master Duel, but earlier). |
| **Tech Stack** | Unity Engine. Originally developed for mobile, later ported to PC via Steam (November 2017). |
| **Open Source** | No -- fully proprietary. |
| **Status** | Active but declining relative to Master Duel. Speed Duel format (3 monster/spell-trap zones). |
| **Card Scripts** | Proprietary internal format. |
| **Platforms** | iOS, Android, Windows (Steam). No browser version. |
| **Notes** | No web browser version exists. Players sometimes use Android emulators to play on desktop. Uses a simplified field layout (Speed Duel format) rather than full Master Rule. |

---

## 3. Open-Source Projects on GitHub

### 3.1 EDOPro / Project Ignis (Desktop Reference)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/edo9300/edopro |
| **Card Scripts** | https://github.com/ProjectIgnis/CardScripts |
| **Type** | Desktop application (Windows, Mac, Linux, iOS, Android ports) |
| **Engine** | OCGCore (C++/Lua). The canonical implementation. |
| **Tech Stack** | C++ (OCGCore + Irrlicht 3D engine for GUI), Lua 5.3 (card scripts) |
| **Open Source** | Yes (AGPL-3.0 for EDOPro, various licenses for sub-components) |
| **Status** | Active. The most complete and authoritative fan-made simulator. |
| **Notes** | Covered in depth in the companion document `research-ygo-duel-engine.md`. Every card except Normal Monsters requires its own Lua script. ~13,000+ cards scripted. No official web client, but OCGCore has been compiled to WASM by third parties (see Section 5). |

### 3.2 yugioh_web (React + Custom JS Engine)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/rickypeng99/yugioh_web |
| **Server** | https://github.com/rickypeng99/yugioh_web_server |
| **Type** | Web-based |
| **Engine** | **Custom JavaScript engine** -- completely rewritten from scratch, does NOT use OCGCore or Lua. |
| **Tech Stack** | React 18.2.0, Node.js 18.12.1, Redux (state), Material-UI, Socket.io (multiplayer) |
| **Open Source** | Yes |
| **Status** | Partially complete. Basic effect activation and chaining logic implemented (demonstrated with Polymerization). Feature is explicitly marked as "partially complete." Dependencies updated as of Feb 2023. Multiplayer server not deployed publicly. |
| **Card Coverage** | Very limited. Only a handful of card effects are implemented. |
| **Notes** | Proves the concept that a JS-only YGO engine is possible, but demonstrates how enormous the card scripting challenge is. Useful as architectural reference for frontend UI layout. |

### 3.3 YGOSiM (Node.js Manual Simulator)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/stevoduhhero/YGOSiM-archive |
| **Type** | Web-based (Node.js server + browser client) |
| **Engine** | Manual -- no automated rules enforcement |
| **Tech Stack** | Node.js |
| **Open Source** | Yes |
| **Status** | Archived/inactive. |
| **Notes** | A browser-based manual simulator similar in concept to Duelingbook. Uses card images from YGOPro. |

### 3.4 yugioh-game (Python Text MUD + OCGCore)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/tspivey/yugioh-game |
| **Type** | Text-based MUD server (not graphical, not browser-based) |
| **Engine** | **OCGCore** -- uses ygopro-core for game mechanics. Compiles Lua on its own. |
| **Tech Stack** | Python, OCGCore (C++ compiled as library), Lua, Docker |
| **Open Source** | Yes (MIT license) |
| **Status** | Low activity. 20 open issues, 124 closed. Multi-language support (EN, ES, DE, FR). |
| **Notes** | Demonstrates that OCGCore can be wrapped by a Python application. Interesting as a minimal-UI approach to duel simulation. |

### 3.5 iygo (MERN Stack)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/lucaskienast/iygo |
| **Type** | Web-based |
| **Engine** | Custom (details unclear from public documentation) |
| **Tech Stack** | MERN (MongoDB, Express, React, Node.js) |
| **Open Source** | Yes |
| **Status** | Early stage / educational project. |
| **Notes** | Appears to be a learning project rather than a production simulator. Limited documentation. |

### 3.6 free-ygo/yugioh-engine (Java)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/free-ygo/yugioh-engine |
| **Type** | Engine library (not a playable application) |
| **Engine** | Custom Java engine |
| **Tech Stack** | Java (99.4%), Lua (0.6%), Maven |
| **Open Source** | Yes (Apache-2.0) |
| **Status** | Early stage. 66 commits, 0 stars, 0 forks, no releases. Minimal community engagement. |
| **Notes** | An attempt to rewrite a YGO engine in Java. The 0.6% Lua suggests it may integrate with Lua scripts to some degree. No documentation on card coverage or completeness. |

### 3.7 Ptival/yugioh (Haskell)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/Ptival/yugioh |
| **Type** | Engine/simulator |
| **Engine** | Custom Haskell implementation |
| **Tech Stack** | Haskell (89.3%), Nix (10.7%), Cabal build system |
| **Open Source** | Yes |
| **Status** | Incomplete/abandoned. 18 commits, 11 stars. README still contains template placeholder text ("Grep for AUTHOR and PROJECT and replace them"). No releases. |
| **Notes** | Academic/experimental. Demonstrates interest in functional programming approaches to card game rules encoding, but never reached usable state. |

---

## 4. Server Implementations

### 4.1 YGOSharp (C# + OCGCore)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/IceYGO/ygosharp |
| **Type** | Duel server (headless) |
| **Engine** | OCGCore (C++ compiled as native DLL, wrapped via C#) |
| **Tech Stack** | C#, CMake (for OCGCore compilation) |
| **Components** | `OCGCore/` (native library), `YGOSharp.OCGWrapper/` (C# wrapper), `YGOSharp.Network/` (networking) |
| **Open Source** | Yes |
| **Status** | Available but not actively maintained. |
| **Notes** | Shows how OCGCore can be wrapped in managed languages. The C# wrapper pattern could theoretically be adapted for other host environments. |

### 4.2 YGOSalvation-Server (Node.js + OCGCore)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/SalvationDevelopment/YGOSalvation-Server |
| **Type** | Server + launcher + management system for YGOPro |
| **Engine** | OCGCore (loaded as native library) |
| **Tech Stack** | Node.js, HTML/CSS/JavaScript (web management UI) |
| **Open Source** | Restricted license -- requires permission for use outside ygosalvation.com |
| **Status** | Available but restrictive licensing. |
| **Notes** | A Node.js wrapper around the YGOPro ecosystem. Demonstrates that OCGCore can be orchestrated from a JavaScript/Node.js environment, but via native bindings (not WASM). |

### 4.3 YgoMaster (C# Master Duel Offline Server)

| Field | Details |
|-------|---------|
| **Repository** | https://github.com/pixeltris/YgoMaster |
| **Type** | Offline server emulator for Yu-Gi-Oh! Master Duel |
| **Engine** | Leverages Master Duel's own engine. Does not include a custom duel engine -- it emulates the server that Master Duel's client connects to, meaning the actual duel logic runs within the official Master Duel client binary. |
| **Tech Stack** | C# (92.4%), C (3.8%), C++ (3.5%) |
| **Open Source** | Yes |
| **Status** | Active. Supports PvP duels, friends, trading, solo content, custom CPU duels, deck creation, card pack opening, replays. |
| **Notes** | Reverse-engineers the Master Duel server protocol, not the duel engine itself. Requires the official Master Duel Steam installation. ~6,000 CPU decks available. Interesting for understanding Master Duel's client-server architecture but not useful as a standalone duel engine. |

---

## 5. OCGCore-to-WebAssembly: The Key Bridge

### 5.1 @n1xx1/ocgcore-wasm

| Field | Details |
|-------|---------|
| **Registry** | https://jsr.io/@n1xx1/ocgcore-wasm |
| **Type** | NPM/JSR package -- OCGCore compiled to WebAssembly |
| **What It Is** | ProjectIgnis' EDOPro Core built for WebAssembly using Emscripten |
| **API** | Both synchronous and asynchronous interfaces. Allows: initializing duels with configurable parameters (duel mode, LP, draw counts, seeds), managing game state through duel handles, processing game logic step-by-step, retrieving game messages, sending player responses. |
| **Requirements** | Sync version: basic JS support. Async version: JSPI + `--experimental-wasm-stack-switching` flag in Node.js. |
| **Platform Support** | Node.js, Deno, Browsers |
| **Status** | Latest version 0.1.1 (published ~9 months ago, as of Feb 2026). JSR score 94%. ~11 weekly downloads. 15 versions published. Zero external dependencies. |
| **Significance** | **This is the most direct path to running OCGCore in a browser.** It proves that the full C++ OCGCore engine can be compiled to WASM and called from JavaScript/TypeScript. Combined with the Lua card scripts (also loadable in-browser via a WASM Lua interpreter), this enables fully automated duels in a browser without any server-side duel processing. |

### 5.2 NEOS Architecture Pattern

NEOS (Section 2.4) demonstrates the complete working architecture:

```
Browser
  +-- React/TypeScript UI (neos-ts)
  +-- Valtio (state management)
  +-- OCGCore.wasm (Emscripten-compiled C++ engine)
       +-- Lua interpreter (embedded in WASM)
       +-- Card scripts (.lua files, loaded at runtime)
       +-- Card database (cards.cdb equivalent)
  +-- WebSocket connection to MyCard server (matchmaking, ranking)
```

This pattern proves that:
1. OCGCore's full rule engine runs in the browser via WASM
2. Lua card scripts (~13,000+ cards) are loaded and executed within the WASM sandbox
3. The TypeScript frontend only handles UI rendering and user interaction
4. Server is only needed for matchmaking/social features, NOT for duel computation
5. Performance is acceptable for real-time gameplay

---

## 6. Rust-Based YGO Engines

**Finding: No Rust-based Yu-Gi-Oh! engine was found.**

Extensive searching across GitHub, crates.io, and general web sources found no dedicated Yu-Gi-Oh! game engine written in Rust. The closest findings:

- A Pokemon TCG Pocket engine in Rust exists (github.com/bcollazo/deckgym-core), demonstrating interest in Rust for card game engines, but nothing for YGO.
- General-purpose card game libraries exist in Rust (`gametools`, `deckofcards-rs`), but none implement YGO rules.
- GitHub Topics for `ygopro` lists 1 Rust project, but it could not be identified in search results and likely has negligible scope.

The YGO community has concentrated engine development effort on C++ (OCGCore), with client implementations in C# (Unity), Python, JavaScript, and Java. No Rust implementation exists at any meaningful level.

---

## 7. YGOPro2 and Web Attempts

**YGOPro2** (github.com/duelists-unite/YGOPro2) is the Unity-based successor to the original YGOPro. Key facts:

- Built with Unity Engine (C#)
- Uses the same YGOPro network protocol
- Maintained by Duelists Unite
- **No web/browser version exists or was attempted**
- Evolved into YGO Omega (same team)

**EDOPro Web Client**: There is no official EDOPro web client. Project Ignis has not published a browser-based version. However, the OCGCore engine that powers EDOPro has been independently compiled to WASM (see Section 5), enabling third-party web clients like NEOS.

**KoishiPRO**: Another OCGCore-based desktop simulator (github.com/purerosefallen/ygopro). No web version. Uses the same Lua card scripts as EDOPro.

---

## 8. Comparison Matrix

| Platform | Web-Based? | Automated? | Engine | Open Source? | Card Coverage | Status |
|----------|-----------|-----------|--------|-------------|--------------|--------|
| **Dueling Nexus** | Yes (browser) | Yes | OCGCore-derived (Lua scripts) | No (proprietary) | Full (~13,000+) | Active |
| **Duelingbook** | Yes (browser) | No (manual) | None | No (proprietary) | Full (visual only) | Active |
| **NEOS** | Yes (browser) | Yes | OCGCore via WASM | Yes | Full (~13,000+) | Active (beta) |
| **YGO Omega** | No (desktop) | Yes + manual | OCGCore + Unity | Partial | Full (~13,000+) | Active |
| **EDOPro** | No (desktop) | Yes | OCGCore (canonical) | Yes | Full (~13,000+) | Active |
| **Master Duel** | No (native) | Yes | Proprietary (Konami) | No | Curated subset | Active |
| **Duel Links** | No (native) | Yes | Proprietary (Konami) | No | Speed Duel subset | Active |
| **yugioh_web** | Yes (browser) | Partial | Custom JS | Yes | Very limited | Stale |
| **YGOSiM** | Yes (browser) | No (manual) | None | Yes | N/A | Archived |
| **yugioh-game** | No (text MUD) | Yes | OCGCore (Python wrap) | Yes (MIT) | Full | Low activity |
| **ocgcore-wasm** | Library only | Yes | OCGCore via WASM | Yes | Full | Active (0.1.1) |
| **YgoMaster** | No (desktop) | Yes* | Master Duel client | Yes | Master Duel set | Active |

*YgoMaster relies on the official Master Duel binary for duel execution.

---

## 9. Key Takeaways for Skytrix

### Regarding Skytrix's Combo Simulator (Solo Testing)

Skytrix is a solo combo testing tool, not a PvP duel platform. This changes the equation:

1. **No opponent AI needed** -- The user controls both sides (or just their own). This means Skytrix does NOT need a full duel engine if the goal is just deck/combo testing.

2. **Skytrix's current approach (manual board manipulation via CommandStackService)** is closest to Duelingbook's model -- the user moves cards, declares effects, and the app tracks state. This is viable and avoids the enormous complexity of a full rules engine.

3. **If automated rules enforcement is ever desired**, the proven path is:
   - Use `@n1xx1/ocgcore-wasm` or compile OCGCore to WASM directly
   - Load ProjectIgnis Lua card scripts
   - Follow the NEOS architecture pattern (TypeScript UI + WASM engine)
   - This would give full card coverage for free but adds massive binary size (~5-10 MB WASM) and complexity

4. **There is no shortcut**: No one has built a JavaScript/TypeScript YGO rules engine with meaningful card coverage. The `yugioh_web` project proved it is possible in theory but only implemented a handful of cards. The card scripting burden (~13,000+ individual Lua scripts, each encoding unique game logic) is the fundamental bottleneck.

5. **Hybrid approach possibility**: Skytrix could remain manual for most interactions but optionally load OCGCore-WASM for specific automated features (e.g., validating summon conditions, resolving chain links). This would be architecturally novel but complex to integrate.

### Architecture Decision

For Skytrix's MVP (solo combo testing), the current manual approach is correct. The Duelingbook model -- user-driven state manipulation with undo/redo -- is the right level of complexity. Adding OCGCore-WASM is a post-MVP consideration that would transform Skytrix from a "combo notepad" into a full simulator.

---

## 10. Sources & References

### Platforms
- [Dueling Nexus](https://duelingnexus.com)
- [Duelingbook](https://www.duelingbook.com)
- [YGO Omega](https://omega.duelistsunite.org)
- [NEOS](https://neos.moecube.com)
- [Master Duel](https://www.konami.com/yugioh/masterduel)
- [Duel Links](https://www.konami.com/yugioh/duel_links)
- [Project Ignis / EDOPro](https://projectignis.github.io)

### GitHub Repositories
- [EDOPro](https://github.com/edo9300/edopro)
- [ProjectIgnis CardScripts](https://github.com/ProjectIgnis/CardScripts)
- [NEOS (neos-ts)](https://github.com/DarkNeos/neos-ts)
- [DuelingNexus org](https://github.com/DuelingNexus)
- [YGOPro2 (Duelists Unite)](https://github.com/duelists-unite/YGOPro2)
- [yugioh_web](https://github.com/rickypeng99/yugioh_web)
- [YGOSiM](https://github.com/stevoduhhero/YGOSiM-archive)
- [yugioh-game (Python MUD)](https://github.com/tspivey/yugioh-game)
- [iygo (MERN)](https://github.com/lucaskienast/iygo)
- [free-ygo/yugioh-engine (Java)](https://github.com/free-ygo/yugioh-engine)
- [Ptival/yugioh (Haskell)](https://github.com/Ptival/yugioh)
- [YGOSharp (C#)](https://github.com/IceYGO/ygosharp)
- [YGOSalvation-Server](https://github.com/SalvationDevelopment/YGOSalvation-Server)
- [YgoMaster](https://github.com/pixeltris/YgoMaster)
- [WindBot-Ignite](https://github.com/ProjectIgnis/WindBot-Ignite)
- [KoishiPRO](https://github.com/purerosefallen/ygopro)
- [ocgcore-KCG](https://github.com/knight00/ocgcore-KCG)
- [ygopro-core (original)](https://github.com/Fluorohydride/ygopro-core)
- [custom-duelingbook](https://github.com/killburne/custom-duelingbook)

### Key Package
- [@n1xx1/ocgcore-wasm on JSR](https://jsr.io/@n1xx1/ocgcore-wasm)

### Additional Sources
- [Edison Format Simulators Guide](https://edisonformat.net/beginners/simulators)
- [YGO Sim Comparison Chart](https://my.visme.co/view/01p6mxd3-ygo-sim-comparison-chart)
- [YGOPRO Scripting Wiki](https://ygoproscripting.miraheze.org/wiki/Main_Page)
- [Master Duel on PCGamingWiki](https://www.pcgamingwiki.com/wiki/Yu-Gi-Oh!_Master_Duel)
- [Unity interview on Master Duel development (Japanese)](https://unity3d.jp/game/konami-yugioh-masterduel/)
- [Duelists Unite Forum](https://forum.duelistsunite.org)
