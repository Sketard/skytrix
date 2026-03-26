---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
session_topic: 'PvP Replay Mode for Skytrix'
session_goals: 'Explore all dimensions: data capture, playback UX, use cases (debug, sharing, learning, spectator), and technical constraints (storage, performance, integration with existing PvP architecture)'
selected_approach: 'ai-recommended'
techniques_used: ['Role Playing', 'Morphological Analysis', 'Reverse Brainstorming']
ideas_generated: [14]
context_file: ''
session_active: false
workflow_completed: true
---

# Brainstorming Session Results

**Facilitator:** Axel
**Date:** 2026-03-21

## Session Overview

**Topic:** PvP Replay Mode — recording, playback, and exploitation of Yu-Gi-Oh! duels in Skytrix
**Goals:** Explore all dimensions: data to capture, playback UX, use cases (debug, sharing, learning, spectator), and technical constraints (storage, performance, integration with existing PvP architecture)

### Session Setup

_Full-scope brainstorming covering capture format, playback experience, use cases beyond debug, and technical integration with the existing tri-service PvP architecture (Angular ↔ WS ↔ Duel Server ↔ HTTP ↔ Spring Boot)._

## Technique Selection

**Approach:** AI-Recommended Techniques
**Analysis Context:** PvP Replay Mode with focus on all dimensions (capture, UX, use cases, technical constraints)

**Recommended Techniques:**

- **Role Playing:** Explore from multiple stakeholder perspectives (player debugging, spectator, learner, developer) to map needs per persona
- **Morphological Analysis:** Systematic decomposition into parameters (what to record × format × controls × storage × sharing) to explore all combinations
- **Reverse Brainstorming:** Stress-test by asking "how to make replay unusable?" to reveal hidden constraints and transform them into requirements

**AI Rationale:** Multi-dimensional topic requiring both breadth (personas, use cases) and depth (technical parameters, failure modes). The sequence moves from empathy → systematic exploration → stress-testing, ensuring comprehensive coverage.

## Technique Execution Results

### Role Playing — Stakeholder Perspectives

**Personas explored:** Developer (primary), Analytical Player (secondary)

**Key insight:** Most players won't use replay post-loss — it requires a deliberate mindset of self-improvement. The primary use case is **developer debugging**, not player analysis.

**Developer persona findings:**
- Reproducing bugs often requires reaching a complex board state (e.g., turn 15 after a specific 14-turn sequence) — replay eliminates hours of manual reproduction
- The dev needs a video-like timeline: play, pause, seek, step forward/back, fast-forward
- Fork capability: deviate from the recorded sequence at any point to test alternative actions and isolate the bug
- The duel becomes an explorable decision tree with branches

**Analytical player persona findings:**
- Same flow as dev — wants to test "what if I had done X instead?"
- Fork transitions into PvP Quick Duel Solo mode with control of both players
- Omniscient view: both hands and face-down cards revealed (information has no strategic value post-game)

**Breakthrough insight:** The replay is two things — a **Sequence Viewer** (read-only timeline) and a **Fork to PvP Quick Duel Solo** (interactive branch from any point). The PvP Quick Duel Solo pipeline already exists (dual WS connections through OCGCore) — replay is a bridge, not a new engine.

### Morphological Analysis — Technical Parameters

| Parameter | Decision |
|-----------|----------|
| **What to record** | Full WS message flux, all 47 types, no filtering |
| **Where to store** | Server-side (Duel Server → Spring Boot API) |
| **Granularity** | All messages — simplicity IS reliability |
| **Format** | Raw WS messages as-is — zero custom format |
| **Access** | Match history list (date, opponent, result) |
| **Retention** | TTL-based, X days configurable, automatic purge |

**Key technical decisions:**
- Event sourcing is native — WS messages ARE the replay format
- Fast-forward = replay events through OCGCore WASM without rendering (milliseconds)
- Single playback engine with variable speed (animated ↔ instant), not two separate modes
- Timers from PvP are ignored in replay

### Reverse Brainstorming — Stress Testing

| Risk | Status | Detail |
|------|--------|--------|
| OCGCore update divergence | Accepted | Rare updates, acceptable for small team |
| UI render divergence | Non-risk | Replay guarantees sequence fidelity, not pixel-perfect rendering |
| Omniscient view exposure | Non-risk | Game is over, no strategic value |
| WASM fast-forward performance | Non-risk | Near-native perf, milliseconds for 14 turns |
| Storage volume | To challenge in Architecture | ~10 players, likely negligible but deserves concrete analysis |
| Replay ↔ PvP Quick Duel Solo transition UX | Open | How to fork, how to return — to design in UX phase |
| Timer handling | Non-risk | Timers ignored by design |

## Idea Organization and Prioritization

### Theme 1: Architecture — Replay = Viewer + Fork to PvP Quick Duel Solo

- **Sequence Viewer:** Video-like navigation through recorded WS event stream (play, pause, step, seek, rewind)
- **Fork to PvP Quick Duel Solo:** At any point, branch into PvP Quick Duel Solo with full OCGCore state reconstructed, controlling both players via dual WS connections
- **Omniscient view:** Both hands and all cards visible in replay
- **Ephemeral tool:** No heavy workflow — open, explore, understand, fix, move on

### Theme 2: Technical Infrastructure — Native Event Sourcing

- **Raw WS capture:** All 47 message types logged by Duel Server without filtering
- **Server persistence:** Stored server-side, retrieved via HTTP API
- **WASM fast-forward:** Seek = replay events through OCGCore without rendering, near-instant
- **TTL retention:** Automatic purge after X configurable days
- **Timers ignored:** PvP wait times not replayed

### Theme 3: Access and UX

- **Match history:** Simple list (date, opponent, result) to access replays
- **Variable speed:** Single engine, continuum between animated playback and instant fast-forward
- **Replay ↔ PvP Quick Duel Solo transition:** UX to design (forking, returning to original timeline)

### Breakthrough Concept

**The replay is not an isolated feature — it is a bridge PvP → PvP Quick Duel Solo.** The existing PvP Quick Duel Solo pipeline (dual WS connections, OCGCore engine) becomes the fork engine. The existing WS protocol becomes the replay format. Almost everything already exists; the replay is primarily wiring between existing components.

### Risks Summary

- **Accepted:** OCGCore update divergence (rare)
- **To challenge in Architecture:** Storage volume (log everything vs. optimized subset)
- **UX open question:** Replay ↔ Solo transition flow
- **Confirmed non-risks:** Render divergence, omniscient view, WASM performance, timers

## Session Summary and Insights

**Key Achievements:**

- Identified the **primary use case is developer debugging**, not player analysis — this reframes the entire feature priority
- Discovered the replay is architecturally a **bridge between existing PvP and PvP Quick Duel Solo modes**, not a new standalone system
- Established that **event sourcing is native** — the WS protocol IS the replay format, minimizing implementation cost
- Stress-tested the concept and found **no blocking risks** for a small team context

**Creative Facilitation Narrative:**

_The session started by challenging the obvious assumption (players replay after losing) and quickly converged on the dev-debug use case as the primary driver. The "duel as video stream" metaphor from Axel became the architectural north star. The fork-and-branch concept emerged naturally from the debug workflow, and the realization that it maps directly to the existing PvP Quick Duel Solo pipeline was the session's breakthrough moment. The Reverse Brainstorming confirmed the concept's robustness — most "risks" turned out to be non-issues in the small-team context._

**Recommended Next Steps:**

1. **Create PRD** (`/bmad-bmm-create-prd`) — formalize discoveries into requirements, using this brainstorming session as input
2. **Create Architecture** (`/bmad-bmm-create-architecture`) — challenge storage volume, detail PvP ↔ Replay ↔ PvP Quick Duel Solo integration
3. **Create UX Design** (`/bmad-bmm-create-ux-design`) — design the replay ↔ PvP Quick Duel Solo transition flow
4. **Create Epics & Stories** (`/bmad-bmm-create-epics-and-stories`) — break down into implementable stories
