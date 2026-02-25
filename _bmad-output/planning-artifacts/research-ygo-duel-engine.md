---
type: technical-research
project: skytrix
author: Claude (AI Research Agent)
date: 2026-02-23
subject: Project Ignis (EDOPro/YGOPro) Duel Engine, WASM Integration & Web Ecosystem
status: complete
last_updated: 2026-02-23
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
8. [Ecosysteme web et implementations existantes](#8-ecosysteme-web-et-implementations-existantes)
9. [Analyse de faisabilite pour Skytrix](#9-analyse-de-faisabilite-pour-skytrix)
10. [Recommandations](#10-recommandations)
11. [Sources et references](#11-sources-et-references)

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

## 8. Ecosysteme web et implementations existantes

### 8.1 Decouverte cle : @n1xx1/ocgcore-wasm

Le package [`@n1xx1/ocgcore-wasm`](https://github.com/n1xx1/ocgcore-wasm) est une compilation d'OCGCore (fork EDOPro) en **WebAssembly via Emscripten**, publiee sur [JSR](https://jsr.io/@n1xx1/ocgcore-wasm) avec des typages TypeScript complets.

| Aspect | Detail |
|---|---|
| **Licence** | MIT (le wrapper) — le core reste AGPL-3.0 |
| **Compatibilite** | Navigateur, Node.js, Deno |
| **Dependances** | Zero |
| **Maturite** | 102 commits, 15 releases, derniere v0.1.1 (~mai 2025) |
| **Core upstream** | edo9300/ygopro-core commit `2d72976` (mai 2025, ocgcore v11.0) + Lua 5.4 |
| **Stars** | ~5 (projet de niche mais fonctionnel, 1 mainteneur) |

**Impact :** Ce package elimine le principal obstacle de l'Option A (compilation Emscripten). L'API C complete d'OCGCore est directement accessible depuis TypeScript sans travail de compilation personnalise.

#### 8.1.1 Taille du binaire WASM

| Fichier | Taille |
|---|---|
| `ocgcore.sync.wasm` | **885 KB** |
| Glue JS Emscripten | ~1.2 MB |
| Wrapper TS | 45 KB |
| Types (.d.ts) | 81 KB |
| **Total runtime (1 mode)** | **~2.1 MB** |

Le WASM est compile avec `-Os` (optimize size), `emmalloc`, `--closure 1`. La taille de 885 KB est tres raisonnable pour une application web.

#### 8.1.2 Deux modes d'execution

| Mode | Callbacks | Compatibilite navigateur | Use case |
|---|---|---|---|
| **Sync** (`sync: true`) | Synchrones uniquement | **Tous les navigateurs** | Donnees pre-chargees en memoire |
| **Async/JSPI** (`sync: false`) | Peuvent retourner des Promises | Chrome 124+ avec flag experimental | Chargement a la demande |

> **⚠️ Pour une app en production, seul le mode sync est viable aujourd'hui.** JSPI (JS Promise Integration) est encore experimental. Cela impose de **pre-charger** tous les scripts Lua et donnees de cartes avant de demarrer un duel.

#### 8.1.3 API TypeScript complete (13 methodes)

```typescript
interface OcgCore {
  getVersion(): readonly [number, number];
  createDuel(options: OcgDuelOptions): OcgDuelHandle | null;
  destroyDuel(handle: OcgDuelHandle): void;
  duelNewCard(handle: OcgDuelHandle, cardInfo: OcgNewCardInfo): void;
  startDuel(handle: OcgDuelHandle): void;
  duelProcess(handle: OcgDuelHandle): OcgProcessResult;  // END | WAITING | CONTINUE
  duelGetMessage(handle: OcgDuelHandle): OcgMessage[];    // Discriminated union typee
  duelSetResponse(handle: OcgDuelHandle, response: OcgResponse): void;
  loadScript(handle: OcgDuelHandle, name: string, content: string): boolean;
  duelQueryCount(handle: OcgDuelHandle, team: number, location: OcgLocation): number;
  duelQuery(handle: OcgDuelHandle, query: OcgQuery): Partial<OcgCardQueryInfo> | null;
  duelQueryLocation(handle: OcgDuelHandle, query: OcgQueryLocation): (Partial<OcgCardQueryInfo> | null)[];
  duelQueryField(handle: OcgDuelHandle): OcgFieldState;
}
```

**Callbacks requis a la creation du duel :**

```typescript
interface OcgDuelOptions {
  flags: OcgDuelMode;                    // ex: MODE_MR5
  seed: [bigint, bigint, bigint, bigint]; // PRNG Xoshiro256**
  team1: { startingLP: number; startingDrawCount: number; drawCountPerTurn: number; };
  team2: { startingLP: number; startingDrawCount: number; drawCountPerTurn: number; };
  cardReader: (card: number) => OcgCardData | null;       // Donnees depuis cards.cdb
  scriptReader: (name: string) => string | null;           // Scripts Lua
  errorHandler?: (type: OcgLogType, text: string) => void;
}
```

#### 8.1.4 Parseur de messages et serialiseur de reponses inclus

**Le package inclut deja un parseur TypeScript complet** pour les ~78 types de messages et un serialiseur pour les 21 types de reponses. Pas besoin d'ecrire un parseur custom.

- `duelGetMessage()` retourne directement des objets TypeScript types (`OcgMessage[]`)
- `duelSetResponse()` accepte des objets TypeScript types (`OcgResponse`)
- Discriminated union sur le champ `type` — compatible avec le pattern matching TypeScript

#### 8.1.5 Systeme de requetes (query)

Le package expose un systeme de requetes pour interroger l'etat de n'importe quelle carte :

```typescript
// Interroger une carte specifique
const info = lib.duelQuery(handle, {
  flags: OcgQueryFlags.CODE | OcgQueryFlags.ATTACK | OcgQueryFlags.POSITION,
  controller: 0, location: OcgLocation.MZONE, sequence: 0, overlaySequence: 0
});
// -> { code: 46986414, attack: 2500, position: POS_FACEUP_ATTACK }

// Etat global du terrain
const field = lib.duelQueryField(handle);
// -> { flags, players: [{ monsters, spells, deck_size, hand_size, ... } x2], chain }
```

#### 8.1.6 Limitations identifiees

| Limitation | Impact pour Skytrix |
|---|---|
| **Pas de save/restore** | Impossible de sauvegarder et reprendre un duel en cours |
| **Pas d'undo** | Le moteur est forward-only. Undo = rejouer depuis le debut avec les reponses sauvegardees |
| **Pas de clonage d'etat** | Impossible d'explorer des branches alternatives ("what-if") |
| **Mode sync bloque le thread** | Des chaines complexes peuvent bloquer le thread JS. Mitigation : Web Worker |
| **Pre-1.0, mainteneur unique** | Risque de bus factor. Mais le core upstream (edo9300) est actif |
| **`bigint` pour flags/seed** | Necessite attention lors de la serialisation JSON |

#### 8.1.7 Consommateur connu

Un seul projet utilise ce package : [`n1xx1/r3f-ygo-sim`](https://github.com/n1xx1/r3f-ygo-sim) — un simulateur Yu-Gi-Oh! en Next.js + React Three Fiber par le meme auteur. Demo live sur Vercel.

### 8.2 Simulateurs web automatises

| Plateforme | Moteur | Open Source | Stack | Statut |
|---|---|---|---|---|
| **Dueling Nexus** | Propre (utilise scripts Lua YGOPro) | Non | Proprietaire | Actif — seul simulateur web automatise populaire |
| **NEOS** ([DarkNeos/neos-ts](https://github.com/DarkNeos/neos-ts)) | OCGCore (serveur) | Oui (GPL-3.0) | React + TypeScript | Actif, en production |
| **SRVPro** ([mycard/srvpro](https://github.com/mycard/srvpro)) | OCGCore (subprocess) | Oui (AGPL-3.0) | Node.js / CoffeeScript | Actif, 202 stars |

**NEOS** est particulierement pertinent : c'est la preuve qu'un client web TypeScript + OCGCore fonctionne en production.

### 8.3 Reimplementations JS/TS (toutes echouees)

| Projet | Stars | Couverture regles | Statut |
|---|---|---|---|
| **yugioh_web** ([rickypeng99](https://github.com/rickypeng99/yugioh_web)) | 112 | ~5% (invocation basique + combat) | Semi-actif |
| **duel-engine** ([donaldnevermore](https://github.com/donaldnevermore/duel-engine)) | 1 | ~1% (squelette) | Mort |

**Conclusion :** Aucune reimplementation JS/TS n'a jamais depasse ~5% des regles. Le volume (50k+ lignes C++, 13k scripts Lua) rend cette approche irealiste. Confirme que l'Option C est un dead-end.

### 8.4 Simulateurs manuels web (sans moteur de regles)

| Plateforme | Stack | Statut |
|---|---|---|
| **Duelingbook** | Proprietaire | Actif, dominant — ~99% manuel |
| **YGOSiM** | Node.js | Archive |

Ces plateformes correspondent au modele actuel de Skytrix (manipulation manuelle + undo/redo).

### 8.5 Simulateurs desktop (non-web)

| Plateforme | Moteur | Stack |
|---|---|---|
| **EDOPro** (Project Ignis) | OCGCore natif | C++ / Irrlicht |
| **YGO Omega** | OCGCore | Unity |
| **Master Duel** (Konami) | Proprietaire | Unity |
| **Duel Links** (Konami) | Proprietaire | Unity |

Aucun n'a de version web. Pas de moteur Rust connu dans l'ecosysteme.

### 8.6 Synthese de l'ecosysteme

```
Moteurs de duel automatises
├── OCGCore (C++) ← standard de facto open-source
│   ├── Natif : EDOPro, YGO Omega
│   ├── Serveur : SRVPro (Node.js), NEOS (React client)
│   └── WASM : @n1xx1/ocgcore-wasm ← NOUVEAU
├── Proprietaires
│   ├── Konami : Master Duel, Duel Links
│   └── Dueling Nexus
└── Reimplementations JS/TS ← toutes echouees (<5% regles)

Simulateurs manuels (pas de moteur)
├── Duelingbook
├── Skytrix (actuel)
└── Divers projets abandonnes
```

### 8.7 Protocole de messages binaires OCGCore

Le protocole de communication entre l'hote et le moteur repose sur des **messages binaires** echanges via `duelGetMessage()` et `duelSetResponse()`.

#### 8.7.1 Format fil

```
Buffer retourne par OCG_DuelGetMessage:
+------------------------------------------------------------------+
| [uint32 size_1][uint8 MSG_TYPE_1][...payload_1]                  |
| [uint32 size_2][uint8 MSG_TYPE_2][...payload_2]                  |
| ...                                                              |
+------------------------------------------------------------------+

- Chaque message : [taille (4 octets LE)][type (1 octet)][payload variable]
- La taille inclut l'octet de type
- Tous les entiers multi-octets sont en little-endian
- Les emplacements de cartes : [controller:u8][location:u8][sequence:u32][position:u32]
```

> **Note :** Avec le package `@n1xx1/ocgcore-wasm`, ce format binaire est abstrait. `duelGetMessage()` retourne directement des objets TypeScript types.

#### 8.7.2 Classification des ~78 types de messages

**Messages necessitant une reponse joueur (20) :**

| Message | Description | Reponse attendue |
|---|---|---|
| `SELECT_IDLECMD` | Actions Main Phase (invoquer, poser, activer, BP, EP) | Index + type de commande |
| `SELECT_BATTLECMD` | Actions Battle Phase (attaquer, activer, M2, EP) | Index + type de commande |
| `SELECT_CARD` | Selectionner carte(s) dans une liste (min/max) | Tableau d'indices |
| `SELECT_CHAIN` | Opportunite d'activation de chaine | Index chaine ou -1 (passer) |
| `SELECT_PLACE` / `SELECT_DISFIELD` | Selection de zone sur le terrain | Masque de zone |
| `SELECT_POSITION` | Position du monstre (ATK/DEF/face-up/down) | Masque de position |
| `SELECT_TRIBUTE` | Selection de tributs pour invocation | Tableau d'indices |
| `SELECT_EFFECTYN` | Oui/Non pour un effet specifique | 0 ou 1 |
| `SELECT_YESNO` | Oui/Non generique | 0 ou 1 |
| `SELECT_OPTION` | Choix parmi options numerotees | Index option |
| `SELECT_COUNTER` | Distribution de compteurs | Tableau de compteurs |
| `SELECT_SUM` | Selectionner cartes jusqu'a atteindre une somme | Tableau d'indices |
| `SELECT_UNSELECT_CARD` | Toggle selection de carte | Index |
| `SORT_CARD` / `SORT_CHAIN` | Ordonner des cartes/chaines | Tableau d'indices ordonnes |
| `ANNOUNCE_RACE` | Declarer un type de monstre | Bitmask race |
| `ANNOUNCE_ATTRIB` | Declarer un attribut | Bitmask attribut |
| `ANNOUNCE_CARD` | Declarer un nom de carte | Passcode |
| `ANNOUNCE_NUMBER` | Declarer un nombre | Nombre choisi |
| `ROCK_PAPER_SCISSORS` | Pierre-feuille-ciseaux (1er tour) | 1/2/3 |

**Messages informationnels / mise a jour d'etat (~58) :**

| Categorie | Messages | Role |
|---|---|---|
| **Deplacement** | `MOVE`, `SET`, `SWAP`, `POS_CHANGE` | Carte change de zone/position |
| **Invocation** | `SUMMONING`/`SUMMONED`, `SPSUMMONING`/`SPSUMMONED`, `FLIPSUMMONING`/`FLIPSUMMONED` | Animations d'invocation |
| **Chaines** | `CHAINING`, `CHAINED`, `CHAIN_SOLVING`, `CHAIN_SOLVED`, `CHAIN_END`, `CHAIN_NEGATED`, `CHAIN_DISABLED` | Cycle de vie des chaines d'effets |
| **Combat** | `ATTACK`, `BATTLE`, `DAMAGE`, `DAMAGE_STEP_START`/`END` | Deroulement du combat |
| **Points de vie** | `LPUPDATE`, `PAY_LPCOST`, `RECOVER` | Changements de LP |
| **Pioche/Melange** | `DRAW`, `SHUFFLE_HAND`, `SHUFFLE_DECK`, `SHUFFLE_SET_CARD` | Actions sur les piles |
| **Compteurs** | `ADD_COUNTER`, `REMOVE_COUNTER` | Compteurs de sort |
| **Tour/Phase** | `NEW_TURN`, `NEW_PHASE` | Progression du duel |
| **Lifecycle** | `START`, `WIN`, `REQUEST_DECK` | Debut/fin de duel |
| **Affichage** | `HINT`, `CONFIRM_CARDS`, `CARD_HINT`, `EQUIP`, `CARD_TARGET` | Informations UI |
| **Aleatoire** | `TOSS_COIN`, `TOSS_DICE` | Resultats de lancers |

#### 8.7.3 Parseurs TypeScript existants

| Projet | Approche | Completude |
|---|---|---|
| **@n1xx1/ocgcore-wasm** | Parseur integre, discriminated union | **Complet** (~78 types) — recommande |
| **DarkNeos/neos-ts** | 43 fichiers parseur individuels + protobuf | Complet, mais couple a NEOS |
| **ygocore-interface** (npm) | Fonction `parseMessage()` standalone | Partiel, ancien |

> **Pour Skytrix, le parseur inclus dans `@n1xx1/ocgcore-wasm` suffit.** Aucun travail de parsing n'est necessaire.

#### 8.7.4 Mapping vers l'architecture Skytrix

| Concept OCGCore | Equivalent Skytrix |
|---|---|
| `controller` (0/1) | Joueur actif / adversaire |
| `location` (MZONE, SZONE, HAND...) | `ZoneId` |
| `sequence` (0-7) | Index dans la zone |
| `position` (FACEUP_ATK...) | Etat face-up/face-down de `CardInstance` |
| `OcgMessage[]` | Flux d'evenements pour mettre a jour `BoardStateService` |
| `OcgResponse` | Actions du joueur transmises au moteur |

---

## 9. Analyse de faisabilite pour Skytrix

### 9.1 Etat actuel de Skytrix (MVP implemente)

**Stack technique :**
- **Frontend** : Angular 19 (standalone components, signals, OnPush) + Angular Material + CDK
- **Backend** : Java 21 / Spring Boot 3.4.2 + PostgreSQL + Flyway
- **Architecture** : SPA classique, API REST, JWT auth

**Simulateur solo (100% fonctionnel) :**
- Simulateur **manuel** (sans moteur de regles) — le joueur a le controle total, 100% frontend
- Command pattern (6 types + CompositeCommand) pour undo/redo complet
- 18 zones de jeu (Master Rule 5 : ST1/ST5 = Pendulum L/R), drag & drop via CDK
- XYZ materials (attach/detach/transfer via overlay), pile overlays (browse/search/reveal)
- Hand fan layout avec reorder, card inspector, mill N, shuffle, reveal N
- Responsive mobile/desktop, keyboard shortcuts (Ctrl+Z/Y)
- ~107 fichiers TS, BoardStateService + CommandStackService scopes au SimulatorPageComponent

**Deckbuilder (100% fonctionnel) :**
- Add/remove cards avec limites de copies, validation deck (40+ main, 0-15 extra/side)
- Export/import YDK, generation PDF proxies, hand test (5 cartes)
- Filtres avances, favoris, suivi de collection (owned cards)
- Sauvegarde API, guard unsaved changes

**Autres fonctionnalites implementees :**
- Recherche de cartes (filtres par type, niveau, attribut, archetype, pagination)
- Auth (login/signup, JWT, route guards)
- Pas de tests automatises (approche "big bang" — tests prevus apres MVP)

### 9.2 Options d'integration

#### Option A : Integration directe du core C++ via WebAssembly (WASM)

**Approche :** Utiliser le package [`@n1xx1/ocgcore-wasm`](https://github.com/n1xx1/ocgcore-wasm) qui compile deja ygopro-core en WASM via Emscripten, avec typages TypeScript complets.

| Aspect | Evaluation |
|---|---|
| Faisabilite technique | **Tres elevee** — Le package WASM existe deja sur JSR, avec API TypeScript complete. Zero compilation necessaire. |
| Complexite | **Moyenne** ~~Haute~~ — Le wrapper TS est fourni. Reste l'integration Angular, le chargement des scripts Lua, et le parsing des messages binaires. |
| Performance | **Excellente** — Execution native dans le navigateur, pas de latence reseau |
| Taille bundle | **Moderee** — ~2-5 MB pour le core + Lua VM compiles en WASM |
| Maintenance | **Moderee** ~~Difficile~~ — Le package suit les releases EDOPro. Pas de recompilation manuelle. |
| Scripts de cartes | Necessaire de charger ~13,000+ fichiers Lua a la demande (lazy loading depuis CDN ou serveur) |
| Infrastructure | **Zero** — Tout tourne dans le navigateur. Pas de serveur de duel necessaire. |

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

### 9.3 Matrice de decision

| Critere (poids) | A: WASM | B: Microservice | C: Reimpl TS | D: JNI |
|---|---|---|---|---|
| Complexite d'integration (30%) | ~~3~~ **4/5** | 4/5 | 1/5 | 3/5 |
| Completude des regles (25%) | 5/5 | 5/5 | 2/5 | 5/5 |
| Maintenance long terme (20%) | ~~2~~ **4/5** | 4/5 | 1/5 | 3/5 |
| Performance (15%) | 5/5 | 3/5 | 4/5 | 5/5 |
| Coherence avec le stack (10%) | ~~3~~ **4/5** | 3/5 | 5/5 | 4/5 |
| **Score pondere** | ~~3.45~~ **4.35** | **4.00** | **2.20** | **3.70** |

> **Mise a jour (fev. 2026) :** La decouverte du package `@n1xx1/ocgcore-wasm` ameliore les scores de l'Option A. Cependant, la decision produit (simulateur complet = PvP en ligne) impose l'anti-triche cote serveur, ce qui **ecarte l'Option A pour la production** et confirme **l'Option B comme choix final**. Voir section 10 pour la justification complete.

### 9.4 Considerations AGPL-3.0

Le core ygopro-core (fork edo9300) est sous **AGPL-3.0-or-later**. Implications :

- **Si Skytrix reste un projet personnel** : Pas de contrainte pratique
- **Si Skytrix est distribue ou deploye comme service** : Tout le code source (y compris le code qui interagit avec le core) doit etre publie sous AGPL-3.0 ou compatible
- **L'option microservice** (B) offre la meilleure isolation de licence : le core tourne dans un process separe, la communication se fait par protocole reseau (WebSocket/HTTP)

---

## 10. Recommandations

### 10.1 Contexte decisif : un frontend, deux modes de simulation

Le frontend Angular existant sera **adapte pour gerer deux modes** au sein de la meme application :

| Mode | Statut | Description | Moteur de regles | Serveur |
|---|---|---|---|---|
| **Mode solo** | **Implemente** | Free mode complet — combo testing manuel, undo/redo, manipulation libre du board, aucune restriction | **Aucun** — le joueur a le controle total | **Aucun** — 100% frontend |
| **Mode PvP** | **A implementer** | Duel complet automatise entre deux joueurs en ligne | **OCGCore** — resolution de regles et chaines | **Obligatoire** — anti-triche |

**Le mode solo reste tel quel** — aucune utilisation du serveur de duel, pas de moteur de regles, pas de restriction. C'est un outil de pratique libre.

**Le mode PvP** reutilise les memes composants de board (zones, cartes, inspecteur) mais avec une source de donnees differente : au lieu du `BoardStateService` local avec `CommandStackService`, l'etat du board vient du serveur de duel via WebSocket. Le joueur ne peut pas manipuler le board librement — il repond aux questions du moteur (selectionner une carte, choisir une zone, confirmer un effet, etc.).

Le PvP impose une contrainte non-negociable : **le moteur doit tourner cote serveur**. Un client WASM serait trivialement exploitable (inspection memoire, modification de reponses, acces aux cartes cachees). C'est redhibitoire pour du PvP en ligne.

### 10.2 Recommandation finale : Option B (Microservice Node.js + ocgcore-wasm)

**L'Option B est le seul choix viable pour un simulateur PvP.**

**Choix technologique : Node.js + `@n1xx1/ocgcore-wasm` (WASM cote serveur)**

Le microservice utilisera le package `@n1xx1/ocgcore-wasm` execute dans un runtime **Node.js** (et non dans un navigateur). Ce choix combine les avantages du WASM (zero compilation C++, API TypeScript) avec ceux du serveur (anti-triche, autorite unique).

| Critere | Justification |
|---|---|
| **TypeScript end-to-end** | Meme langage frontend (Angular) et serveur de duel. Types partages (`OcgMessage`, `OcgResponse`, enums). |
| **Zero compilation C++** | Pas de toolchain C++17, pas de Premake5, pas de shared library. `npm install` suffit. |
| **Docker trivial** | Image Node.js alpine + package WASM. Pas de compilation native dans le container. |
| **Parseur inclus** | Le package inclut deja parseur de messages et serialiseur de reponses. Aucun travail de parsing. |
| **API identique** | Meme API TypeScript que decrite en section 8.1.3. Le code du PoC est reutilisable tel quel. |
| **Precedent** | SRVPro (202 stars) utilise deja Node.js pour wrapper OCGCore cote serveur. |

**Pourquoi pas C++ natif ou JNI ?**
- **C++ natif** : Necessite toolchain C++17, Premake5, compilation platform-specific. Complexite de build elevee sans gain de performance significatif (le WASM tourne a ~90-95% de la vitesse native, et un duel YGO ne necessite pas de performance extreme).
- **JNI** : Risque de crash JVM, complexite des bindings, pas de reutilisation des types TypeScript. Le stack Java (Spring Boot) reste dedie a l'auth, au matchmaking et a la gestion de decks.

**Avantages du choix :**

1. **Anti-triche garanti** : Le serveur est l'autorite unique. Il ne transmet au client que les informations que le joueur a le droit de voir (ses propres cartes en main, les cartes face-up). Les reponses sont validees par le moteur.
2. **Separation propre** : Le duel server tourne dans son propre process Node.js, isole du stack Java/Angular
3. **Precedent solide** : C'est le modele de SRVPro (Node.js, 202 stars) et NEOS (React + serveur OCGCore), tous deux en production
4. **Reutilisation maximale** : 100% des regles et scripts de cartes fonctionnent sans modification
5. **Isolation AGPL** : Le core tourne dans un process separe, communication par protocole reseau
6. **Scripts Lua** : Stockes cote serveur, charges par le callback `scriptReader` via `fs.readFileSync()`
7. **Maintenance minimale** : Mise a jour du core = `npm update @n1xx1/ocgcore-wasm`. Pas de recompilation.

> **L'Option A (WASM cote client) est ecartee pour la production.** Le WASM dans le navigateur est incompatible avec l'anti-triche PvP. Il reste utile comme outil de dev/test local (voir section 10.5).

**Architecture cible :**

```
+------------------+     WebSocket      +----------------------------+
|  Angular 19 SPA  | =================> | Duel Server (Node.js)      |
|  (frontend)      |  (duel en cours)   | @n1xx1/ocgcore-wasm        |
|                  | <================= |                            |
|  - Board UI      |   messages JSON    | - ocgcore WASM (885 KB)   |
|  - Actions       |   (infos visibles  | - cards.cdb (SQLite)      |
|  - Animations    |    uniquement)     |                            |
+------------------+                    +----------------------------+
         |                                       ^
         | REST API                              | HTTP interne
         v                                      | (creer duel + decklist)
+------------------+                             |
| Spring Boot API  | ============================/
| (backend existant)|
| - Auth / JWT     |   1. POST /matchmaking
| - Matchmaking    |   2. Spring Boot envoie les decklists au Duel Server
| - Deck validation|   3. Duel Server retourne room_id + ws_url
| - Decklists (DB) |   4. Spring Boot renvoie ws_url + token au frontend
+------------------+   5. Frontend se connecte en WebSocket au Duel Server
         |
         v
+------------------+                    +----------------------------+
|   PostgreSQL     |                    | ProjectIgnis/CardScripts   |
| - users, decks   |                    | (13,000+ fichiers Lua)    |
+------------------+                    +----------------------------+
```

**Flux de lancement d'un duel :**

```
Frontend                Spring Boot              Duel Server (Node.js)
   |                        |                           |
   |-- POST /matchmaking -->|                           |
   |                        |-- HTTP: create duel ----->|
   |                        |   (decklist J1 + J2)      |
   |                        |<-- room_id + ws_url ------|
   |<-- ws_url + token -----|                           |
   |                        |                           |
   |=========== WebSocket (duel messages) =============>|
   |<=========== WebSocket (game state) ================|
   |                        |                           |
```

> **Le frontend ne transmet jamais la decklist au Duel Server.** C'est Spring Boot qui l'envoie directement (server-to-server). Cela empeche un client modifie d'envoyer un deck truque.

### 10.3 Modele de securite anti-triche

| Principe | Implementation |
|---|---|
| **Serveur autorite** | Le moteur OCGCore tourne exclusivement cote serveur. Le client n'a jamais acces a l'etat complet du duel. |
| **Filtrage des messages** | Le serveur filtre les messages OCGCore avant envoi : les cartes face-down de l'adversaire, son deck, son extra deck ne sont jamais transmis. |
| **Validation des reponses** | OCGCore valide nativement les reponses (impossible d'invoquer une carte qu'on n'a pas, de selectionner un index invalide). Les reponses illegales sont rejetees. |
| **Pas d'etat client** | Le client est un pur afficheur + collecteur d'inputs. Aucune logique de regles cote frontend. |
| **Auth par partie** | Chaque connexion WebSocket est authentifiee via le JWT existant. Un joueur ne peut interagir qu'avec son propre duel. |

### 10.4 Etapes d'implementation suggerees (Option B — Microservice Node.js)

**Phase 1 : Prototype serveur (PoC)**
1. Initialiser un projet Node.js/TypeScript pour le duel server
2. Installer le package : `npx jsr add @n1xx1/ocgcore-wasm`
3. Implementer les callbacks `cardReader` (lecture depuis cards.cdb via `better-sqlite3`) et `scriptReader` (lecture Lua via `fs.readFileSync()`)
4. Exposer une API HTTP interne pour la creation de duel (recoit les decklists depuis Spring Boot)
5. Charger un duel simple (2 decks predefinis) et valider la boucle `createDuel -> duelProcess -> duelGetMessage -> duelSetResponse`
6. Exposer l'API joueur via WebSocket (ex: `ws` ou `socket.io`)
7. Implementer le filtrage de messages : ne transmettre au client que les infos visibles par le joueur concerne
8. Containeriser : Dockerfile basique `FROM node:22-alpine` + copie des scripts Lua et cards.cdb

**Phase 2 : Integration UI PvP**
1. Creer un service Angular `DuelWebSocketService` qui gere la connexion WebSocket au duel server
2. Reutiliser les types TypeScript de `@n1xx1/ocgcore-wasm` cote client (`OcgMessage`, `OcgResponse`, enums) pour typer le protocole WebSocket
3. Adapter les composants du simulateur pour afficher l'etat reel du duel
4. Implementer les reponses joueur pour les 20 types de `SELECT_*` (UI de selection de cartes, confirmation d'effets, choix de zone, etc.)

**Phase 3 : Infrastructure PvP**
1. Integrer le matchmaking dans le backend Spring Boot existant (file d'attente, creation de parties)
2. Implementer le flux de creation de duel : Spring Boot envoie les decklists au Duel Server via HTTP interne, recoit `room_id` + `ws_url`, transmet au frontend
3. Le frontend ne transmet jamais la decklist au Duel Server (anti-triche : seul Spring Boot, apres validation, communique les decks)
4. Gerer le cycle de vie des duels cote serveur (timeout, deconnexion, reconnexion)
5. Ajouter la validation de deck cote Spring Boot avant le lancement du duel (banlist, format, taille)

**Phase 4 : Joueur IA (optionnel)**
1. Implementer un joueur IA basique cote serveur (reponses aleatoires ou heuristiques)
2. Permettre au joueur humain de jouer contre l'IA via le meme pipeline PvP

### 10.5 Option A (WASM) comme outil de dev

Bien qu'ecartee pour la production, `@n1xx1/ocgcore-wasm` reste utile pour :
- **Tests locaux** : Valider rapidement l'integration sans demarrer le serveur de duel
- **Prototypage UI** : Developper les composants de selection/reponse en local
- **Reference de types** : Les types TypeScript du package (`OcgMessage`, `OcgResponse`, enums) sont reutilisables cote client meme avec un serveur backend

### 10.6 Resultats du PoC (Phase 1 validee)

Un PoC fonctionnel a ete developpe dans `duel-server/` pour valider la Phase 1 de la section 10.4.

#### 10.6.1 Stack technique du PoC

| Composant | Version | Role |
|---|---|---|
| Node.js | 22+ | Runtime |
| TypeScript | 5.9 | Langage |
| `@n1xx1/ocgcore-wasm` | 0.1.1 (JSR) | Moteur OCGCore en WASM |
| `better-sqlite3` | 12.6 | Lecture de cards.cdb |
| `tsx` | 4.21 | Execution directe TypeScript |
| `patch-package` | 8.0 | Correctif ESM (voir 10.6.3) |

#### 10.6.2 Resultats de validation

**Test 1 : Chargement du core** — `src/test-core.ts`
- OCGCore v11.0 charge avec succes dans Node.js via WASM
- Creation et destruction de duel fonctionnels
- Callbacks `cardReader`, `scriptReader`, `errorHandler` correctement appeles

**Test 2 : Duel complet** — `src/poc-duel.ts`
- 2 decks identiques de 34 cartes (monstres normaux Niveau 4 + spells/traps)
- 19/20 scripts Lua utilitaires charges au demarrage (`proc_toon.lua` manquant — non bloquant)
- Duel Master Rule 5, 8000 LP par joueur
- Auto-player repondant a tous les types de `SELECT_*` avec la premiere option valide

**Resultats obtenus :**

```
Turn 1: Player 0 — Normal Summon Luster Dragon #2 (ATK 1900)
Turn 2: Player 1 — Normal Summon Luster Dragon #2, attaque (meme ATK, destruction mutuelle)
Turn 3: Player 0 — Normal Summon Mechanicalchaser, attaque directe → Player 1 -1200 LP
Turn 4: Player 1 — Normal Summon Mechanicalchaser, attaque (meme ATK)
Turn 5: Player 0 — Normal Summon
...
Etat final: Player 0 = 8000 LP, Player 1 = 6800 LP
```

**Tous les points valides :**
- ✅ `createDuel()` — creation de duel avec callbacks
- ✅ `loadScript()` — chargement manuel des scripts utilitaires
- ✅ `duelNewCard()` — ajout de cartes au deck
- ✅ `startDuel()` — demarrage du duel
- ✅ `duelProcess()` + `duelGetMessage()` + `duelSetResponse()` — boucle de jeu complete
- ✅ `duelQueryField()` — requete d'etat final (LP, deck_size, hand_size, grave_size, banish_size)
- ✅ Messages informationnels : `NEW_TURN`, `DRAW`, `SUMMONING`, `ATTACK`, `DAMAGE`, `LPUPDATE`
- ✅ Reponses joueur : `SELECT_IDLECMD`, `SELECT_BATTLECMD`, `SELECT_CHAIN`, `SELECT_PLACE`, `SELECT_POSITION`

#### 10.6.3 Problemes rencontres et solutions

| Probleme | Cause | Solution |
|---|---|---|
| `does not provide export named 'default'` | Le wrapper JSR-to-npm utilise `export * from "./dist/index.js"` qui ne re-exporte pas les `export default` (spec ESM) | Patch via `patch-package` : ajout de `export { default } from "./dist/index.js"` dans `mod.js` |
| `GetID not found` dans les scripts Lua | Les scripts utilitaires (`utility.lua`, `constant.lua`, `proc_*.lua`) ne sont pas charges automatiquement par le core | Chargement manuel de 20 scripts via `core.loadScript()` apres `createDuel()` mais avant `duelNewCard()` |
| Pas de combat dans le duel | Deck initial avec des monstres Niveau 7+ (non invocables sans tribut) | Remplacement par des monstres Niveau 4 normaux (Alexandrite Dragon, Gene-Warped Warwolf, etc.) |
| `initial_effect` error sur certaines cartes | Scripts individuels manquants pour certains monstres normaux (pas dans le repo CardScripts) | Non bloquant — les monstres normaux fonctionnent sans script individuel |

#### 10.6.4 Fichiers du PoC

```
duel-server/
├── package.json                    # type: "module", scripts: poc, postinstall
├── tsconfig.json                   # ES2022, ESNext, bundler resolution
├── patches/
│   └── @n1xx1+ocgcore-wasm+0.1.1.patch  # Fix ESM default export
├── src/
│   ├── test-core.ts                # Test minimal : chargement WASM + creation duel
│   └── poc-duel.ts                 # PoC complet : 2 decks, boucle de jeu, auto-player
└── data/
    ├── cards.cdb                   # Base SQLite (7.2 MB, ProjectIgnis/BabelCDB)
    └── scripts_full/               # 13,227 scripts Lua (ProjectIgnis/CardScripts)
        ├── constant.lua, utility.lua, proc_*.lua  (20 utilitaires)
        └── official/c*.lua          (scripts de cartes individuels)
```

#### 10.6.5 Conclusion du PoC

Le PoC confirme que **Node.js + `@n1xx1/ocgcore-wasm`** est viable pour le duel server Skytrix. L'API TypeScript est complete, le moteur OCGCore execute correctement les regles du jeu (invocations, combat, dommages, phases), et le pattern `duelProcess/getMessage/setResponse` est simple a implementer. Les prochaines etapes (Phase 2-3) concernent l'exposition WebSocket et l'integration frontend.

---

## 11. Sources et references

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
- [mycard/srvpro](https://github.com/mycard/srvpro) — Serveur Node.js/CoffeeScript wrappant OCGCore (AGPL-3.0, 202 stars)

### Package WASM et clients web
- [@n1xx1/ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) — OCGCore compile en WebAssembly via Emscripten (MIT, TypeScript)
- [JSR: @n1xx1/ocgcore-wasm](https://jsr.io/@n1xx1/ocgcore-wasm) — Package publie sur JSR
- [DarkNeos/neos-ts](https://github.com/DarkNeos/neos-ts) — Client web React+TypeScript pour OCGCore (GPL-3.0, en production)
- [rickypeng99/yugioh_web](https://github.com/rickypeng99/yugioh_web) — Tentative de reimplementation JS (~5% regles, 112 stars)

### Documentation de creation de cartes
- [Ygopro-Card-Creation](https://github.com/KittyTrouble/Ygopro-Card-Creation) — Documentation du schema cards.cdb
- [DataEditorX](https://ygoproscripting.miraheze.org/wiki/DataEditorX) — Editeur de base de donnees de cartes
- [Setup for adding cards into a simulator](https://ygoproscripting.miraheze.org/wiki/Setup_for_adding_cards_into_a_simulator) — Guide de setup
