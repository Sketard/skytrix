# Sound Effects Guide — Skytrix

All sounds sourced from **Pixabay** — royalty-free, no attribution required, MP3 format.

## How to use

1. Click links below, listen, download the MP3
2. Trim long sounds if needed: `ffmpeg -i input.mp3 -t 0.5 -af "afade=t=out:st=0.3:d=0.2" output.mp3`
3. Rename each file to match the **File name** column below
4. Place all files in this folder (`front/src/assets/sfx/`)

---

## Summoning / Magic

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `summon.mp3` | Normal Summon — magic whoosh | [Summoning sound](https://pixabay.com/sound-effects/summoning-sound-42744/) | [search "summon"](https://pixabay.com/sound-effects/search/summon/) |
| `specialsummon.mp3` | Special Summon — power surge | [Stand Summon Effect](https://pixabay.com/sound-effects/film-special-effects-stand-summon-effect-40997/) | [search "power surge"](https://pixabay.com/sound-effects/search/power%20surge/) |
| `activate.mp3` | Spell/Trap activation — spell cast | [Magic Spell Cast Game](https://pixabay.com/sound-effects/magic-spell-cast-game-sound-effect-379226/) | [search "spell"](https://pixabay.com/sound-effects/search/spell/) |

## Card Handling

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `flip.mp3` | Flip Summon — card flip | [Card Flipping](https://pixabay.com/sound-effects/card-flipping-75622/) | [search "card-flip"](https://pixabay.com/sound-effects/search/card-flip/) |
| `set.mp3` | Set a card face-down — card place | [Playing Cards](https://pixabay.com/sound-effects/playing-cards-36817/) | [search "card"](https://pixabay.com/sound-effects/search/card/) |
| `draw.mp3` | Draw a card — slide/pick | — | [search "card"](https://pixabay.com/sound-effects/search/card/) — pick a short slide sound |
| `shuffle.mp3` | Deck shuffle | [Riffle Card Shuffle](https://pixabay.com/sound-effects/film-special-effects-riffle-card-shuffle-104313/) | [search "card shuffle"](https://pixabay.com/sound-effects/search/card%20shuffle/) |
| `equip.mp3` | Equip card — metallic click | [Folding Knife Metallic Click](https://pixabay.com/sound-effects/film-special-effects-folding-knife-deployment-sharp-metallic-click-sound-359988/) | [search "metallic click"](https://pixabay.com/sound-effects/search/metallic%20click/) |

## Combat

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `attack.mp3` | Attack declaration — sword slash | [Sword Slash with Impact](https://pixabay.com/sound-effects/film-special-effects-sword-slash-with-a-designed-impact-185434/) | [search "sword slash"](https://pixabay.com/sound-effects/search/sword%20slash/) |
| `destroyed.mp3` | Card destroyed — shatter | — | [search "glass shatter"](https://pixabay.com/sound-effects/search/glass%20shatter/) — pick a short one (~0.5s) |
| `banished.mp3` | Card banished — dark void whoosh | [Dark Empty Void](https://pixabay.com/sound-effects/horror-dark-empty-void-53012/) | [search "dark whoosh"](https://pixabay.com/sound-effects/search/dark%20whoosh/) |

## Life Points

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `damage.mp3` | LP damage / pay cost — hit impact | — | [search "punch"](https://pixabay.com/sound-effects/search/punch/) or [search "game hit"](https://pixabay.com/sound-effects/search/game%20hit/) |
| `gainlp.mp3` | LP recovery — heal chime | — | [search "heal"](https://pixabay.com/sound-effects/search/heal/) or [search "healing game"](https://pixabay.com/sound-effects/search/healing%20game/) |

## Random Events

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `coinflip.mp3` | Coin toss (~1s) | — | [search "coin-flip"](https://pixabay.com/sound-effects/search/coin-flip/) |
| `diceroll.mp3` | Dice roll (~1-2s) | — | [search "roll-dice"](https://pixabay.com/sound-effects/search/roll-dice/) |

## Counters

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `addcounter.mp3` | Add counter — tick/click | [Minimal UI Pack](https://pixabay.com/sound-effects/minimal-ui-pack-pops-clicks-ticks-27052/) | [search "tick"](https://pixabay.com/sound-effects/search/tick/) |
| `removecounter.mp3` | Remove counter — reverse tick | — | [search "tick"](https://pixabay.com/sound-effects/search/tick/) — pick a different sound from addcounter |

## UI / Duel Flow

| File name | Description | Direct link | Search alternative |
|---|---|---|---|
| `phase.mp3` | Phase change — soft chime | — | [search "notification chime"](https://pixabay.com/sound-effects/search/notification%20chime/) |
| `nextturn.mp3` | Turn transition — bell | — | [search "chime"](https://pixabay.com/sound-effects/search/chime/) |
| `playerenter.mp3` | Player joins lobby | [Notification Sound Effect](https://pixabay.com/sound-effects/notification-sound-effect-372475/) | [search "pop-up"](https://pixabay.com/sound-effects/search/pop-up/) |
| `chatmessage.mp3` | Chat message received | — | [search "ui message"](https://pixabay.com/sound-effects/search/ui%20message/) |

---

## EDOPro Event-to-Sound Mapping (reference)

This is how EDOPro maps game messages to sounds. Use this as reference when wiring up `SoundService` in the `AnimationOrchestratorService`.

| OCGCore Message | Sound | Notes |
|---|---|---|
| `MSG_SUMMONING` | `summon` | Chant override via `summon/{passcode}` |
| `MSG_SPSUMMONING` | `specialsummon` | Chant override via `summon/{passcode}` |
| `MSG_FLIPSUMMONING` | `flip` | Chant override via `summon/{passcode}` |
| `MSG_CHAINING` | `activate` | Chant override via `activate/{passcode}` |
| `MSG_SET` | `set` | Always |
| `MSG_MOVE` + `REASON_DESTROY` | `destroyed` | Only when reason includes DESTROY |
| `MSG_MOVE` to `LOCATION_REMOVED` | `banished` | Only when not REASON_DESTROY |
| `MSG_EQUIP` | `equip` | Always |
| `MSG_ATTACK` | `attack` | Chant override via `attack/{passcode}` |
| `MSG_DRAW` | `draw` | Once per card drawn |
| `MSG_SHUFFLE_DECK` | `shuffle` | Always |
| `MSG_SHUFFLE_HAND` | `shuffle` | Only when count > 1 |
| `MSG_SHUFFLE_EXTRA` | `shuffle` | Only when count > 1 |
| `MSG_DAMAGE` | `damage` | — |
| `MSG_PAY_LPCOST` | `damage` | Same as damage |
| `MSG_RECOVER` | `gainlp` | — |
| `MSG_ADD_COUNTER` | `addcounter` | — |
| `MSG_REMOVE_COUNTER` | `removecounter` | — |
| `MSG_TOSS_COIN` | `coinflip` | — |
| `MSG_TOSS_DICE` | `diceroll` | — |
| `MSG_NEW_TURN` | `nextturn` | — |
| `MSG_NEW_PHASE` | `phase` | — |

## Implementation Notes

- Use Web Audio API (`AudioContext`) for low-latency playback
- Preload all 21 SFX as `AudioBuffer` at app init (~50-100KB total)
- Suppress sounds during replay fast-forward (EDOPro does this via `isCatchingUp`)
- Hook into `AnimationOrchestratorService.processEvent()` — each event type already routes there
- Add volume slider + mute toggle to duel UI settings
- Per CLAUDE.md: SoundService must work through `AnimationDataSource` interface to ensure replay parity
