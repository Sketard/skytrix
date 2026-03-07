# Duel Server — Data Setup

The duel server requires two external data sources from **ProjectIgnis** to run OCGCore duels:

1. **Card Scripts** — Lua files defining each card's effects (~13,000+ files)
2. **Card Database** — SQLite `.cdb` file containing card metadata (names, stats, types)

## Prerequisites

- Git

## Download

### 1. Card Scripts (Lua)

```bash
cd duel-server/data
git clone https://github.com/ProjectIgnis/CardScripts.git scripts_full
```

### 2. Card Database (.cdb)

```bash
cd duel-server/data
git clone https://github.com/ProjectIgnis/BabelCDB.git babel-cdb-tmp
cp babel-cdb-tmp/cards.cdb cards.cdb
rm -rf babel-cdb-tmp
```

> `cards.cdb` at the repo root is the one needed for standard OCG/TCG duels.

## Expected Structure

```
data/
├── cards.cdb              # ProjectIgnis/BabelCDB (~7MB SQLite)
└── scripts_full/          # ProjectIgnis/CardScripts
    ├── constant.lua
    ├── utility.lua
    ├── proc_fusion.lua
    ├── ...                # Startup scripts
    ├── c89631139.lua      # Individual card scripts
    ├── ...                # ~13,000+ card scripts
    ├── pre-errata/
    └── pre-release/
```

## Updating

```bash
cd duel-server/data/scripts_full && git pull
```

Restart the duel server after updating. In-progress duels keep their loaded scripts.
