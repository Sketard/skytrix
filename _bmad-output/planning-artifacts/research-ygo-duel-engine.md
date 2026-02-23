---
type: technical-research
project: skytrix
author: Claude (AI Research Agent)
date: 2026-02-23
subject: Project Ignis (EDOPro/YGOPro) Duel Engine & Lua Scripting System
status: complete
---

# Recherche Technique : Moteur de Duel YGOPro / Project Ignis

## Table des Matieres

1. [Vue d'ensemble de l'ecosysteme](#1-vue-densemble-de-lecosysteme)
2. [Architecture du moteur de duel (OCGCore)](#2-architecture-du-moteur-de-duel-ocgcore)
3. [Systeme de scripting Lua pour les effets de cartes](#3-systeme-de-scripting-lua-pour-les-effets-de-cartes)
4. [Encodage et execution des regles du jeu](#4-encodage-et-execution-des-regles-du-jeu)
5. [Base de donnees de cartes (cards.cdb)](#5-base-de-donnees-de-cartes-cardscdb)
6. [Dependances et composants cles](#6-dependances-et-composants-cles)
7. [API C headless pour simulation automatisee](#7-api-c-headless-pour-simulation-automatisee)
8. [Analyse de faisabilite pour Skytrix](#8-analyse-de-faisabilite-pour-skytrix)
9. [Recommandations](#9-recommandations)
10. [Sources et references](#10-sources-et-references)

---

## 1. Vue d'ensemble de l'ecosysteme

### Repositories principaux (Project Ignis / EDOPro)

| Repository | Role | Langage | Licence |
|---|---|---|---|
| [edo9300/ygopro-core](https://github.com/edo9300/ygopro-core) | Moteur de duel (fork actif EDOPro) | C++17 | AGPL-3.0-or-later |
| [edo9300/edopro](https://github.com/edo9300/edopro) | Client GUI (Irrlicht) | C++ | AGPL-3.0 |
| [ProjectIgnis/CardScripts](https://github.com/ProjectIgnis/CardScripts) | Scripts Lua de toutes les cartes officielles | Lua | - |
| [ProjectIgnis/BabelCDB](https://github.com/ProjectIgnis/BabelCDB) | Base de donnees de cartes (SQLite .cdb) | SQL | - |
| [Fluorohydride/ygopro-core](https://github.com/Fluorohydride/ygopro-core) | Moteur original (reference historique) | C++ | GPL |
| [Fluorohydride/ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) | Scripts Lua originaux | Lua | - |

### Historique des forks

```
Fluorohydride/ygopro-core (original)
  |
  +-- edo9300/ygopro-core (EDOPro - fork actif, incompatible avec l'original)
  +-- knight00/ocgcore-KCG (fork KCG)
  +-- mycard/ygopro-core (fork MyCard)
```

> **Important :** Le fork edo9300 a accumule de nombreux changements et est **incompatible** avec les autres forks. Les scripts Lua de ProjectIgnis ne fonctionnent qu'avec le core EDOPro.

---

## 2. Architecture du moteur de duel (OCGCore)

### 2.1 Architecture globale

Le moteur est une **state machine cooperative par etapes** (step-based cooperative state machine). Il est concu comme une **bibliotheque C/C++ sans interface graphique**, consommable via une API C pure.

```
+------------------------------------------------------------------+
|                        API C (ocgapi.h)                          |
|  OCG_CreateDuel / OCG_StartDuel / OCG_DuelProcess                |
|  OCG_DuelGetMessage / OCG_DuelSetResponse / OCG_DuelQuery        |
+------------------------------------------------------------------+
         |                    |                      |
    +----v----+        +------v------+        +------v------+
    |  duel   |        | interpreter |        |    field    |
    | (owner) |<------>|   (Lua VM)  |<------>| (game state)|
    +---------+        +-------------+        +-------------+
         |                    |                      |
    +----v----+        +------v------+        +------v------+
    |  card   |        |  effect     |        |  processor  |
    | objects |        |  objects    |        | (FSM units) |
    +---------+        +-------------+        +-------------+
```

### 2.2 Classe `duel` (point d'entree)

La classe `duel` est le conteneur principal :

- **`game_field`** : pointeur vers l'objet `field` (etat du jeu)
- **`lua`** : l'interpreteur Lua (wrapper autour de `lua_State`)
- **Collections gerees** : `cards`, `groups`, `effects` (unordered_sets avec ownership)
- **`data_cache`** : cache des donnees de cartes lues depuis les callbacks
- **Callbacks** : `card_reader`, `script_reader`, `log_handler` (fournis par l'hote)
- **RNG** : Xoshiro256StarStar (PRNG deterministe)
- **Messages** : file de `duel_message` (serialisation binaire)

### 2.3 Classe `field` (etat du jeu)

La classe `field` represente l'etat complet du duel :

**Joueurs (player_info x2) :**
- Points de vie (LP)
- Zones : `list_mzone[7]`, `list_szone[8]`
- Piles : deck, hand, graveyard (grave), banished (removed), extra deck
- Compteurs de draw

**Etat du tour (field_info) :**
- `phase` : phase courante (DRAW, STANDBY, MAIN1, BATTLE, MAIN2, END...)
- `turn_player` : joueur actif (0 ou 1)
- `turn_id` : compteur de tours
- `event_id` : sequenceur d'evenements

**Registre d'effets (field_effect) :**
- Effets indexes par type pour des lookups rapides

**Processeur (processor) :**
- File d'unites de traitement (processor units)
- Chaque unite = type de processus + etape courante + donnees contextuelles

### 2.4 Machine a etats du processeur

Le processeur maintient une **pile d'unites de traitement**. Chaque unite a :
- `type` : un `PROCESSOR_*` enum (ex: `PROCESSOR_SOLVE_CHAIN`)
- `step` : l'etape courante dans ce processus (0, 1, 2...)
- Donnees contextuelles (effet declencheur, groupe cible, arguments)

**Cycle d'execution :**

```
1. OCG_DuelProcess() appele par l'hote
2. Le processeur depile l'unite courante
3. Switch sur le type -> appel de la fonction associee (process_*)
4. La fonction avance step par step (case 0, case 1, ...)
5. Si besoin d'input joueur -> envoie un MESSAGE, retourne WAITING
6. L'hote lit le message, envoie la reponse via OCG_DuelSetResponse()
7. OCG_DuelProcess() reprend a l'etape suivante
8. Quand un processus termine, l'unite est depilee
9. Boucle jusqu'a fin du duel (retourne END) ou besoin d'input (WAITING)
```

**Processeurs principaux :**

| Processeur | Role |
|---|---|
| `PROCESSOR_TURN` | Gestion du tour (phases) |
| `PROCESSOR_PHASE_EVENT` | Transition de phase |
| `PROCESSOR_POINT_EVENT` | Fenetre de declenchement d'effets |
| `PROCESSOR_QUICK_EFFECT` | Fenetre pour effets rapides |
| `PROCESSOR_SELECT_CHAIN` | Selection de chaine par le joueur |
| `PROCESSOR_SOLVE_CHAIN` | Resolution de la chaine |
| `PROCESSOR_SELECT_CARD` | Selection de carte(s) |
| `PROCESSOR_SELECT_EFFECTYN` | Confirmation oui/non d'activation |
| `PROCESSOR_SELECT_POSITION` | Choix de position (ATK/DEF) |
| `PROCESSOR_ANNOUNCE_RACE` | Declaration de type de monstre |
| `PROCESSOR_ANNOUNCE_ATTRIB` | Declaration d'attribut |
| `PROCESSOR_SSET` | Pose de magie/piege |

### 2.5 Resolution de chaines d'effets

La resolution de chaines suit le protocole officiel Yu-Gi-Oh! :

```
1. process_point_event : Detecte les effets declenches
   - core.new_fchain_s : chaines forcees (obligatoires)
   - core.new_ochain_s : chaines optionnelles (surface)
   - core.new_ochain_h : chaines optionnelles (main)

2. process_quick_effect : Fenetre d'activation rapide
   - Tour du joueur prioritaire, puis adversaire

3. PROCESSOR_SELECT_CHAIN : Le joueur choisit d'activer ou non

4. Construction de la chaine (add_chain)
   - Verifie les conditions, couts, cibles
   - Incremente chain_count

5. PROCESSOR_SOLVE_CHAIN : Resolution (LIFO)
   - Resout chaque maillon du dernier au premier
   - Appelle l'operation Lua de chaque effet
   - Gere les redirections, negations, immunites
```

Les evenements sont propages via `raise_event()` et `raise_single_event()`, qui notifient tous les effets registres qui ecoutent un code d'evenement specifique.

---

## 3. Systeme de scripting Lua pour les effets de cartes

### 3.1 Structure d'un fichier script de carte

Chaque carte a un fichier Lua nomme `c{passcode}.lua` (ex: `c46986414.lua` pour Dark Magician).

**Structure canonique :**

```lua
-- Metadata
local s, id = GetID()

-- Point d'entree obligatoire : enregistrement des effets
function s.initial_effect(c)
    -- Effet 1 : Effet declenche
    local e1 = Effect.CreateEffect(c)
    e1:SetCategory(CATEGORY_SPECIAL_SUMMON)
    e1:SetType(EFFECT_TYPE_TRIGGER_O + EFFECT_TYPE_SINGLE)
    e1:SetCode(EVENT_SUMMON_SUCCESS)
    e1:SetCountLimit(1, id)
    e1:SetCondition(s.condition1)
    e1:SetCost(s.cost1)
    e1:SetTarget(s.target1)
    e1:SetOperation(s.operation1)
    c:RegisterEffect(e1)

    -- Effet 2 : Effet continu
    local e2 = Effect.CreateEffect(c)
    e2:SetType(EFFECT_TYPE_FIELD)
    e2:SetCode(EFFECT_UPDATE_ATTACK)
    e2:SetTargetRange(LOCATION_MZONE, 0)
    e2:SetValue(500)
    c:RegisterEffect(e2)
end

-- Fonctions de callback
function s.condition1(e, tp, eg, ep, ev, re, r, rp)
    -- Retourne true/false
    return Duel.GetTurnPlayer() == tp
end

function s.cost1(e, tp, eg, ep, ev, re, r, rp, chk)
    if chk == 0 then
        return Duel.CheckLPCost(tp, 1000)
    end
    Duel.PayLPCost(tp, 1000)
end

function s.target1(e, tp, eg, ep, ev, re, r, rp, chk)
    if chk == 0 then
        return Duel.IsExistingMatchingCard(s.filter1, tp, LOCATION_GRAVE, 0, 1, nil)
    end
    Duel.SetOperationInfo(0, CATEGORY_SPECIAL_SUMMON, nil, 1, tp, LOCATION_GRAVE)
end

function s.operation1(e, tp, eg, ep, ev, re, r, rp)
    local g = Duel.SelectMatchingCard(tp, s.filter1, tp, LOCATION_GRAVE, 0, 1, 1, nil)
    if #g > 0 then
        Duel.SpecialSummon(g, 0, tp, tp, false, false, POS_FACEUP)
    end
end

function s.filter1(c, e, tp)
    return c:IsCanBeSpecialSummoned(e, 0, tp, false, false)
end
```

### 3.2 Cycle de vie d'un effet

```
1. CHARGEMENT : Le core charge le script via OCG_ScriptReader callback
   -> interpreter::load_card_script(code)
   -> Execute le fichier Lua dans la VM

2. INITIALISATION : Le core appelle s.initial_effect(card)
   -> Cree les objets Effect, configure leurs proprietes
   -> Enregistre les effets sur la carte via c:RegisterEffect(e)

3. DETECTION : Le processeur verifie les conditions de declenchement
   -> Pour chaque evenement (EVENT_SUMMON_SUCCESS, etc.)
   -> Verifie e:GetCondition() -> appelle s.conditionN()
   -> Si l'effet est activable, le propose au joueur

4. ACTIVATION :
   a. COUT : Appelle s.costN(e, tp, ..., chk=1) pour payer le cout
   b. CIBLAGE : Appelle s.targetN(e, tp, ..., chk=1) pour verifier/selectionner les cibles
   c. Le maillon est ajoute a la chaine

5. RESOLUTION :
   -> Appelle s.operationN(e, tp, ...) pour executer l'effet
   -> Les fonctions Duel.* (SpecialSummon, Draw, Destroy...) sont des coroutines
   -> Elles yielden vers le core C++ pour traitement asynchrone

6. FIN : L'effet est marque comme resolu, la chaine continue (LIFO)
```

### 3.3 API Lua exposee par le core

L'API est repartie en **5 namespaces Lua**, chacun mappe vers un fichier C++ :

| Namespace Lua | Fichier C++ | Role |
|---|---|---|
| `Duel.*` | `libduel.cpp` | Actions de jeu globales (draw, damage, summon, destroy...) |
| `Card.*` | `libcard.cpp` | Proprietes et actions sur une carte |
| `Effect.*` | `libeffect.cpp` | Creation et configuration d'effets |
| `Group.*` | `libgroup.cpp` | Manipulation de groupes de cartes |
| `Debug.*` | `libdebug.cpp` | Fonctions de debogage |

**Fonctions Duel.* principales :**

| Categorie | Fonctions cles |
|---|---|
| Pioche | `Duel.Draw(player, count, reason)` |
| Invocation | `Duel.SpecialSummon(group, sumtype, tp, target_player, ...)` |
| Destruction | `Duel.Destroy(target, reason, dest)` |
| Dommages | `Duel.Damage(player, amount, reason)`, `Duel.Recover(...)` |
| Deplacement | `Duel.SendtoHand(...)`, `Duel.SendtoGrave(...)`, `Duel.Remove(...)` |
| Requetes | `Duel.GetMatchingGroup(filter, tp, loc1, loc2, ...)` |
| Selection | `Duel.SelectMatchingCard(tp, filter, ...)` |
| Information | `Duel.GetTurnPlayer()`, `Duel.GetCurrentPhase()`, `Duel.GetLP(tp)` |
| Chaine | `Duel.GetChainInfo(chainc, ...)`, `Duel.NegateEffect(chainc)` |
| Annonces | `Duel.AnnounceRace(tp, count, available)`, `Duel.AnnounceAttribute(...)` |

**Pattern d'implementation C++ -> Lua :**

Chaque fonction Duel.* suit le meme pattern :
1. Extraire les parametres depuis la pile Lua (`lua_tointeger`, etc.)
2. Deleguer au moteur via `game_field->method(...)`
3. **Yield** via `lua_yieldk()` avec une lambda de continuation
4. A la reprise, pousser les valeurs de retour sur la pile Lua

C'est ce mecanisme de yield/resume qui permet au moteur de suspendre l'execution Lua quand il a besoin d'un input joueur (ex: selectionner une carte), puis de reprendre exactement ou il s'etait arrete.

### 3.4 Fichier utility.lua (bibliotheque auxiliaire)

Le fichier `utility.lua` (charge globalement au demarrage) fournit :

- **Combinateurs logiques** : `Auxiliary.AND`, `Auxiliary.OR`, `Auxiliary.NOT`
- **Filtres** : `Auxiliary.FilterBoolFunction`, `Auxiliary.TargetEqualFunction`
- **Fonctions de cout** : `Cost.SelfBanish()`, `Cost.Tribute()`, `Cost.Discard()`, `Cost.PayLP()`
- **Procedures d'invocation** : modules separees pour Fusion, Ritual, Synchro, XYZ, Pendulum, Link
- **Helpers de zones** : `Auxiliary.GetMMZonesPointedTo()`, `Card.CheckAdjacent()`
- **Helpers d'etat** : `Card.IsMonster()`, `Card.IsSpell()`, `Card.IsTrap()`, `Card.IsFusionMonster()`

---

## 4. Encodage et execution des regles du jeu

### 4.1 Constantes du jeu

Toutes les constantes sont definies dans `ocgapi_constants.h` :

**Emplacements (LOCATION_*) :**
`DECK(0x01)`, `HAND(0x02)`, `MZONE(0x04)`, `SZONE(0x08)`, `GRAVE(0x10)`, `REMOVED(0x20)`, `EXTRA(0x40)`, `OVERLAY(0x80)`

**Positions (POS_*) :**
`FACEUP_ATTACK(0x1)`, `FACEDOWN_ATTACK(0x2)`, `FACEUP_DEFENSE(0x4)`, `FACEDOWN_DEFENSE(0x8)`

**Types de cartes (TYPE_*) :**
`MONSTER`, `SPELL`, `TRAP`, `NORMAL`, `EFFECT`, `FUSION`, `RITUAL`, `SYNCHRO`, `XYZ`, `PENDULUM`, `LINK`, `TOKEN`, `QUICKPLAY`, `CONTINUOUS`, `EQUIP`, `FIELD`, `COUNTER`, etc. (27 types combinables par bitmask)

**Attributs (ATTRIBUTE_*) :** `EARTH`, `WATER`, `FIRE`, `WIND`, `LIGHT`, `DARK`, `DIVINE`

**Races (RACE_*) :** 30+ types (Warrior, Spellcaster, Dragon, etc.)

**Phases (PHASE_*) :** `DRAW`, `STANDBY`, `MAIN1`, `BATTLE_START`, `BATTLE_STEP`, `DAMAGE`, `DAMAGE_CAL`, `BATTLE`, `MAIN2`, `END`

### 4.2 Modes de duel predefinis

Le moteur supporte differents formats via des flags combinables :

| Mode | Description |
|---|---|
| `MODE_MR5` | Master Rule 5 (regles actuelles) |
| `MODE_MR4` | Master Rule 4 (Link-centic) |
| `MODE_MR3` | Master Rule 3 (pre-Link) |
| `MODE_GOAT` | Goat Format (2005) |
| `MODE_RUSH` | Rush Duel |
| `MODE_SPEED` | Speed Duel |

Chaque mode active/desactive des **flags granulaires** comme : `DUEL_EMZONE`, `DUEL_SEPARATE_PZONE`, `DUEL_1ST_TURN_DRAW`, `DUEL_NO_MAIN_PHASE_2`, etc.

### 4.3 Enchainement des regles

Les regles du jeu ne sont **pas codees dans les scripts Lua** mais dans le **core C++ lui-meme** :

- **Structure du tour** : `processor.cpp` (process_turn, process_phase_event)
- **Regles d'invocation** : `operations.cpp` (normal_summon, special_summon, flip_summon)
- **Combat** : `operations.cpp` (attack, battle_damage_calculation)
- **Regles de chaines** : `processor.cpp` (add_chain, solve_chain)
- **Regles de priority** : `processor.cpp` (SEGOC, trigger ordering)
- **Regles de zones** : `field.cpp` (get_useable_count, is_location_useable)

Les scripts Lua definissent **ce que chaque carte fait individuellement**, tandis que le core C++ definit **les regles universelles du jeu** (quand on peut invoquer, comment les chaines se resolvent, l'ordre des phases, etc.).

---

## 5. Base de donnees de cartes (cards.cdb)

Le fichier `cards.cdb` est une base SQLite3 avec deux tables :

### Table `datas` (donnees gameplay)

```sql
CREATE TABLE datas (
    id        INTEGER PRIMARY KEY,  -- Passcode (ID unique de la carte)
    ot        INTEGER,              -- OCG/TCG (1=OCG, 2=TCG, 3=Both)
    alias     INTEGER,              -- ID alternatif (art alternate, 0 sinon)
    setcode   INTEGER,              -- Code(s) d'archetype
    type      INTEGER,              -- Bitmask de types (TYPE_MONSTER | TYPE_EFFECT...)
    atk       INTEGER,              -- ATK (-2 = ?)
    def       INTEGER,              -- DEF (-2 = ?, ou Link rating encode)
    level     INTEGER,              -- Niveau (+ echelles Pendule encodees en hex)
    race      INTEGER,              -- Bitmask type de monstre (RACE_WARRIOR...)
    attribute INTEGER,              -- Bitmask attribut (ATTRIBUTE_DARK...)
    category  INTEGER               -- Categorie pour le constructeur de deck
);
```

### Table `texts` (textes)

```sql
CREATE TABLE texts (
    id    INTEGER PRIMARY KEY,  -- Meme passcode que datas
    name  TEXT,                 -- Nom de la carte
    desc  TEXT,                 -- Description / texte d'effet
    str1  TEXT,                 -- Prompt 1 (ex: "Activer cet effet ?")
    str2  TEXT,                 -- Prompt 2
    ...
    str16 TEXT                  -- Prompt 16
);
```

**Encodage special du champ `level` pour les Pendules :**
Le champ level encode niveau + echelles en hexadecimal : `0xLLRRLEVL` ou LL = echelle gauche, RR = echelle droite, LEVL = niveau.

---

## 6. Dependances et composants cles

### 6.1 Dependances du core (ygopro-core)

| Dependance | Version | Role |
|---|---|---|
| **Lua** | 5.3+ (compile depuis les sources) | VM pour les scripts de cartes |
| **Compilateur C++17** | GCC 7+ / Clang 5+ / MSVC 2017+ | Build du core |
| **Premake5** | - | Systeme de build (genere Makefiles/VS solutions) |

> **Point crucial** : Le core n'a **aucune autre dependance** que Lua. Pas de boost, pas de librairie reseau, pas de framework GUI. C'est une bibliotheque pure logique.

### 6.2 Build du core

```bash
# Clone
git clone https://github.com/edo9300/ygopro-core.git

# Build statique
premake5 gmake2    # ou vs2019/vs2022
make config=release_x64  # Produit libocgcore.a

# Build dynamique (shared library)
# Utiliser la solution "ocgcoreshared" -> produit libocgcore.so / ocgcore.dll
```

### 6.3 Composants du client EDOPro (non necessaires pour le core)

| Composant | Role | Necessaire pour simulation headless ? |
|---|---|---|
| Irrlicht (fork) | Rendu 3D / GUI | **Non** |
| FreeType | Rendu de texte | **Non** |
| OpenSSL | Networking securise | **Non** |
| SFML/miniaudio/SDL | Audio | **Non** |
| Premake5 | Build system | Oui (pour build le core) |
| Vcpkg | Package manager | Optionnel |

---

## 7. API C headless pour simulation automatisee

### 7.1 Interface publique (ocgapi.h)

```c
// Creation d'un duel
int OCG_CreateDuel(OCG_Duel* duel, OCG_DuelOptions options);

// Ajout d'une carte au duel
void OCG_DuelNewCard(OCG_Duel duel, OCG_NewCardInfo info);

// Demarrage de la simulation
void OCG_StartDuel(OCG_Duel duel);

// Avancer la state machine (retourne OCG_DuelStatus: RUNNING, WAITING, END)
int OCG_DuelProcess(OCG_Duel duel);

// Lire les messages binaires produits par le duel
void* OCG_DuelGetMessage(OCG_Duel duel, uint32_t* length);

// Envoyer la reponse du joueur
void OCG_DuelSetResponse(OCG_Duel duel, const void* buffer, uint32_t length);

// Charger un script Lua
int OCG_LoadScript(OCG_Duel duel, const char* buffer, uint32_t length, const char* name);

// Requete d'etat sur les cartes
uint32_t OCG_DuelQueryCount(OCG_Duel duel, uint8_t team, uint32_t loc);
void* OCG_DuelQuery(OCG_Duel duel, uint32_t* length, OCG_QueryInfo info);
void* OCG_DuelQueryField(OCG_Duel duel, uint32_t* length);
```

### 7.2 Callbacks requis (OCG_DuelOptions)

```c
typedef struct {
    // Callbacks obligatoires
    OCG_DataReader  cardReader;      // Fournit les donnees d'une carte (depuis la BDD)
    OCG_ScriptReader scriptReader;   // Fournit le script Lua d'une carte
    OCG_LogHandler   logHandler;     // Gere les messages de log/erreur
    void*           payload;         // Donnees utilisateur passees aux callbacks

    // Configuration du duel
    uint64_t seed[4];               // Graine PRNG (Xoshiro256**)
    uint64_t flags;                 // Flags de mode (MODE_MR5, etc.)
    uint8_t  team1_options;         // Options joueur 1 (LP, draw count...)
    uint8_t  team2_options;         // Options joueur 2
} OCG_DuelOptions;
```

### 7.3 Workflow d'un duel headless

```
1. Initialiser : OCG_CreateDuel(&duel, options)
   - Fournir les callbacks cardReader, scriptReader, logHandler
   - Configurer LP, draw count, mode de duel

2. Charger les decks :
   - Pour chaque carte du deck J1 : OCG_DuelNewCard(duel, {code, team=0, loc=DECK})
   - Pour chaque carte ED J1 : OCG_DuelNewCard(duel, {code, team=0, loc=EXTRA})
   - Idem pour J2

3. Demarrer : OCG_StartDuel(duel)

4. Boucle principale :
   while (true) {
       status = OCG_DuelProcess(duel);

       if (status == END) break;

       // Lire les messages
       buffer = OCG_DuelGetMessage(duel, &length);
       messages = parse_messages(buffer, length);

       for (msg in messages) {
           if (msg.type == MSG_SELECT_CARD) {
               // IA ou joueur choisit
               response = decide(msg);
               OCG_DuelSetResponse(duel, response, response_len);
           }
           // ... traiter chaque type de message
       }
   }
```

### 7.4 Implementations serveur existantes

| Projet | Langage | Description |
|---|---|---|
| [SalvationDevelopment/YGOCore](https://github.com/SalvationDevelopment/YGOCore) | C# | Serveur de duel avec API standard streams |
| [IceYGO/ygosharp](https://github.com/IceYGO/ygosharp) | C# | Implementation C# d'un serveur de duel |
| [garymabin/YGOCore](https://github.com/garymabin/YGOCore) | C# | Fork du serveur YGOCore |

---

## 8. Analyse de faisabilite pour Skytrix

### 8.1 Etat actuel de Skytrix

**Stack technique :**
- **Frontend** : Angular 19 (standalone components, signals, OnPush) + Angular Material + CDK
- **Backend** : Java 21 / Spring Boot 3.4.2 + PostgreSQL + Flyway
- **Architecture** : SPA classique, API REST, JWT auth

**Simulateur existant :**
- Simulateur **manuel** (sans moteur de regles) — le joueur a le controle total
- Frontend-only, command pattern pour undo/redo
- 18 zones de jeu, drag & drop via CDK
- Pas de simulation IA, pas de resolution de chaines automatique

### 8.2 Options d'integration

#### Option A : Integration directe du core C++ via WebAssembly (WASM)

**Approche :** Compiler ygopro-core en WASM, l'executer cote frontend dans le navigateur.

| Aspect | Evaluation |
|---|---|
| Faisabilite technique | **Elevee** — C++17 se compile bien en WASM via Emscripten. Lua compile aussi en WASM. |
| Complexite | **Haute** — Necessite un wrapper JS/TS autour de l'API C, gestion memoire manuelle, integration avec Angular |
| Performance | **Excellente** — Execution native dans le navigateur, pas de latence reseau |
| Taille bundle | **Moderee** — ~2-5 MB pour le core + Lua VM compiles en WASM |
| Maintenance | **Difficile** — Chaque mise a jour du core necessite recompilation WASM, suivi des changements API |
| Scripts de cartes | Necessaire de bundler ~13,000+ fichiers Lua ou les charger a la demande |

#### Option B : Core C++ cote serveur (microservice natif)

**Approche :** Compiler le core en shared library (.so), l'appeler depuis un microservice (C++, Rust, ou via JNI depuis Java).

| Aspect | Evaluation |
|---|---|
| Faisabilite technique | **Elevee** — Approche classique, deja faite par YGOCore/ygosharp |
| Complexite | **Moyenne** — API C bien definie, serveur de duel = boucle de messages |
| Performance | **Excellente** cote serveur, latence reseau pour chaque action |
| Integration | Communication WebSocket entre Angular et le serveur de duel |
| Maintenance | **Moderee** — Le core se met a jour independamment |
| Scripts de cartes | Stockes cote serveur, charges a la demande par le core |

#### Option C : Reimplementation partielle en TypeScript (frontend-only)

**Approche :** Reimplementer un sous-ensemble des regles en TypeScript, en s'inspirant de l'architecture du core.

| Aspect | Evaluation |
|---|---|
| Faisabilite technique | **Possible** mais massive |
| Complexite | **Tres haute** — Le core fait ~50,000+ lignes C++, ~13,000 scripts Lua |
| Performance | **Bonne** cote frontend |
| Completude | **Impossible** d'etre complet — trop de regles edge-case |
| Maintenance | **Cauchemar** — Chaque nouvelle carte/regle necessite une MAJ |
| Avantage | Pas de dependance binaire, 100% web |

#### Option D : Core C++ cote serveur via JNI (integration Spring Boot)

**Approche :** Charger `libocgcore.so` directement dans le process Java via JNI/JNA.

| Aspect | Evaluation |
|---|---|
| Faisabilite technique | **Elevee** — JNI/JNA permet d'appeler du code natif depuis Java |
| Complexite | **Moyenne-haute** — Ecriture des bindings JNI, gestion memoire cross-boundary |
| Integration | S'integre directement dans le backend Spring Boot existant |
| Performance | **Excellente** — Pas de communication inter-process |
| Scripts de cartes | Stockes sur le filesystem du serveur |
| Risque | JNI peut causer des crashes du JVM si mal gere |

### 8.3 Matrice de decision

| Critere (poids) | A: WASM | B: Microservice | C: Reimpl TS | D: JNI |
|---|---|---|---|---|
| Complexite d'integration (30%) | 3/5 | 4/5 | 1/5 | 3/5 |
| Completude des regles (25%) | 5/5 | 5/5 | 2/5 | 5/5 |
| Maintenance long terme (20%) | 2/5 | 4/5 | 1/5 | 3/5 |
| Performance (15%) | 5/5 | 3/5 | 4/5 | 5/5 |
| Coherence avec le stack (10%) | 3/5 | 3/5 | 5/5 | 4/5 |
| **Score pondere** | **3.45** | **4.00** | **2.20** | **3.70** |

### 8.4 Considerations AGPL-3.0

Le core ygopro-core (fork edo9300) est sous **AGPL-3.0-or-later**. Implications :

- **Si Skytrix reste un projet personnel** : Pas de contrainte pratique
- **Si Skytrix est distribue ou deploye comme service** : Tout le code source (y compris le code qui interagit avec le core) doit etre publie sous AGPL-3.0 ou compatible
- **L'option microservice** (B) offre la meilleure isolation de licence : le core tourne dans un process separe, la communication se fait par protocole reseau (WebSocket/HTTP)

---

## 9. Recommandations

### 9.1 Recommandation principale : Option B (Microservice natif)

**Pour un simulateur automatique de duels dans Skytrix, l'option B (microservice) est recommandee :**

1. **Separtion propre** : Le core tourne dans son propre process, isole du stack Java/Angular
2. **Reutilisation maximale** : 100% des regles et scripts de cartes fonctionnent sans modification
3. **Mise a jour facile** : Recompiler le core quand ProjectIgnis publie une MAJ, sans toucher au reste
4. **Precedent** : C'est exactement l'approche utilisee par YGOCore, ygosharp, et les serveurs de duel en production
5. **Isolation AGPL** : Le core tourne dans un process separe

**Architecture cible :**

```
+------------------+     WebSocket     +-------------------+
|  Angular 19 SPA  | <===============> | Duel Server       |
|  (frontend)      |                   | (C++ ou Rust)     |
|                  |                   |                   |
|  - Board UI      |                   | - ocgcore.so      |
|  - Actions       |                   | - card scripts/   |
|  - Animations    |                   | - cards.cdb       |
+------------------+                   +-------------------+
         |                                      |
         | REST API                              | File I/O
         v                                      v
+------------------+                   +-------------------+
| Spring Boot API  |                   | Lua scripts       |
| (backend existant)|                  | (13,000+ fichiers)|
+------------------+                   +-------------------+
```

### 9.2 Etapes d'implementation suggerees

**Phase 1 : Prototype (PoC)**
1. Compiler ygopro-core (edo9300 fork) en shared library sur Linux
2. Ecrire un wrapper minimaliste en C/C++ ou Rust qui expose l'API via WebSocket
3. Charger un duel simple (2 decks predefinis) et echanger des messages
4. Valider que la boucle CreateDuel -> Process -> GetMessage -> SetResponse fonctionne

**Phase 2 : Integration minimale**
1. Connecter le frontend Angular au serveur de duel via WebSocket
2. Adapter le simulateur existant pour afficher l'etat reel du duel (read-only)
3. Traduire les messages binaires OCGCore en DTOs TypeScript
4. Implementer les reponses joueur (selection de cartes, confirmation d'effets)

**Phase 3 : IA et automatisation**
1. Implementer un joueur IA basique (reponses aleatoires ou heuristiques)
2. Permettre au joueur humain de jouer contre l'IA
3. Explorer les options d'IA plus avancees (tree search, ML)

### 9.3 Alternative legere : Enrichir le simulateur manuel existant

Si l'objectif est **d'ajouter des regles partielles** au simulateur manuel (sans aller jusqu'a un duel automatique complet), une approche hybride est envisageable :

- Garder le simulateur frontend-only
- Ajouter des **validations TypeScript** pour les regles simples (limites d'invocations normales, phases de jeu)
- Integrer un **moteur de resolution de chaines simplifie** en TypeScript
- Ne **pas** essayer de reproduire le systeme Lua complet

Cette approche est moins ambitieuse mais ne necessite aucune infrastructure additionnelle.

---

## 10. Sources et references

### Documentation et wikis
- [YGOPRO Scripting Wiki (Miraheze)](https://ygoproscripting.miraheze.org/wiki/Main_Page) — Reference principale pour le scripting Lua
- [Structure of a card script](https://ygoproscripting.miraheze.org/wiki/Structure_of_a_card_script) — Anatomie d'un script de carte
- [List of Duel Functions](https://ygoproscripting.miraheze.org/wiki/List_of_Duel_Functions) — Reference de l'API Duel.*
- [Creation, building, and registration of an Effect object](https://ygoproscripting.miraheze.org/wiki/Creation,_building,_and_registration,_of_an_effect_object) — Cycle de vie d'un effet
- [List of functions that move cards across locations](https://ygoproscripting.miraheze.org/wiki/List_of_functions_that_move_cards_across_locations) — Fonctions de deplacement

### Repositories de reference
- [edo9300/ygopro-core](https://github.com/edo9300/ygopro-core) — Fork actif du core (EDOPro)
- [edo9300/edopro](https://github.com/edo9300/edopro) — Client EDOPro complet
- [ProjectIgnis/CardScripts](https://github.com/ProjectIgnis/CardScripts) — Scripts Lua de toutes les cartes
- [Fluorohydride/ygopro-core](https://github.com/Fluorohydride/ygopro-core) — Core original (reference historique)
- [Fluorohydride/ygopro-scripts](https://github.com/Fluorohydride/ygopro-scripts) — Scripts originaux

### Serveurs de duel (reference d'implementation)
- [SalvationDevelopment/YGOCore](https://github.com/SalvationDevelopment/YGOCore) — Serveur C# avec API standard streams
- [IceYGO/ygosharp](https://github.com/IceYGO/ygosharp) — Serveur C# utilisant ocgcore
- [garymabin/YGOCore](https://github.com/garymabin/YGOCore) — Fork du serveur YGOCore

### Documentation de creation de cartes
- [Ygopro-Card-Creation](https://github.com/KittyTrouble/Ygopro-Card-Creation) — Documentation du schema cards.cdb
- [DataEditorX](https://ygoproscripting.miraheze.org/wiki/DataEditorX) — Editeur de base de donnees de cartes
- [Setup for adding cards into a simulator](https://ygoproscripting.miraheze.org/wiki/Setup_for_adding_cards_into_a_simulator) — Guide de setup
