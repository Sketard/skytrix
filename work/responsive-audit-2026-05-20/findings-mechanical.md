# Responsive Audit — Mechanical Findings

_Generated 2026-05-20T06:49:25.719Z_

## Grid overview (initial state, FR locale)

| Page \\ Viewport | 360 | 414 | 360L | 414L | 768 | 1024 | 1280 | 1920 |
|---|---|---|---|---|---|---|---|---|
| Login | T1 H1 | T3 H1 | T3 H1 | T3 H1 E1 R1 | T3 H1 E1 R1 | T3 H1 | T3 H1 E1 R1 | T3 |
| Decks (list) | T4 H2 | T4 H2 | T4 H2 | T4 H2 | T5 H2 | T5 H2 | T5 H1 | T5 H1 |
| Deck Builder | T20 H1 A4 | T20 H1 A4 | T20 H1 A3 | T20 H1 A3 | T20 H1 A2 | T20 H1 A2 | T20 H1 A2 | T20 H1 A2 |
| Simulator | T7 H1 | T7 H1 | T7 H1 | T7 H1 | T3 H1 | T3 H1 | T3 H1 | T3 |
| Card Search | T14 H1 A3 | T14 H1 A3 | T14 H1 A3 | T14 H1 A3 | T17 H2 A2 | T17 H1 A2 | T17 H1 A2 | T17 H1 A1 |
| Preferences | T4 H1 A1 | T4 H1 A1 | T2 H1 A1 | T2 H1 A1 | T5 H1 A1 | T3 H1 A1 | T3 H1 A1 | T3 H1 A1 |
| Parameters (admin) | T2 H1 | T2 H1 | T2 H1 | T2 H1 | T3 H1 | T3 H1 | T3 H1 | T3 H1 |
| PvP Lobby | T3 H1 A1 | T3 H1 A1 | T3 H1 A1 | T3 H1 A1 | T4 H1 A1 | T4 H1 A1 | T4 H1 A1 | T4 H1 A1 |
| Replay Hub | T17 H1 A1 | T18 H1 A1 | T14 H1 A1 | T14 H1 A1 | T20 H11 | T17 H1 A1 | T18 H1 A1 | T20 H1 A1 |
| Replay Viewer | T6 H1 | T6 H1 | T7 | T7 | T9 H1 | T13 | T13 | T13 |
| Duel in-game (fork-solo) | T3 H15 | T3 H15 | T3 H15 A1 | T3 H15 A1 | T3 H15 | T3 H15 A1 | T3 H15 A1 | T3 H15 A1 |

Legend: `OF<px>` overflow · `T<n>` undersized touch · `X<n>` truncated · `B<n>` broken img · `H<n>` hidden-overflow · `E<n>` console err · `R<n>` failed req · `A<n>` axe violations · `✓` no finding

## Login (01-login)

### 360px

- **Final URL** `http://localhost:4200/login` (2399ms)
- **Undersized touch targets** (1):
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 135px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 360px · state=error-state

- **Final URL** `http://localhost:4200/login` (5415ms)
- **Undersized touch targets** (1):
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 133px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414px

- **Final URL** `http://localhost:4200/login` (2242ms)
- **Undersized touch targets** (3):
  - `<button>` 165x39 — Se connecter
  - `<button>` 165x39 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 126px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414px · state=error-state

- **Final URL** `http://localhost:4200/login` (5420ms)
- **Undersized touch targets** (3):
  - `<button>` 165x39 — Se connecter
  - `<button>` 165x39 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 125px — (empty)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/74677422
- **a11y violations** (3, critical/serious: 0):

### 360Lpx

- **Final URL** `http://localhost:4200/login` (2267ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Se connecter
  - `<button>` 190x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 109px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 360Lpx · state=error-state

- **Final URL** `http://localhost:4200/login` (5385ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Se connecter
  - `<button>` 190x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 104px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414Lpx

- **Final URL** `http://localhost:4200/login` (4275ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Se connecter
  - `<button>` 190x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 95px — (empty)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/46986414
- **a11y violations** (3, critical/serious: 0):

### 414Lpx · state=error-state

- **Final URL** `http://localhost:4200/login` (5460ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Se connecter
  - `<button>` 190x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 92px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 768px

- **Final URL** `http://localhost:4200/login` (2296ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 70px — (empty)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/46986414
- **a11y violations** (3, critical/serious: 0):

### 768px · state=error-state

- **Final URL** `http://localhost:4200/login` (5442ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 68px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 1024px

- **Final URL** `http://localhost:4200/login` (2328ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 29px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 1024px · state=error-state

- **Final URL** `http://localhost:4200/login` (5408ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 27px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 1280px

- **Final URL** `http://localhost:4200/login` (2362ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 13px — (empty)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/74677422
- **a11y violations** (3, critical/serious: 0):

### 1280px · state=error-state

- **Final URL** `http://localhost:4200/login` (5492ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **a11y violations** (3, critical/serious: 0):

### 1920px

- **Final URL** `http://localhost:4200/login` (2464ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **a11y violations** (3, critical/serious: 0):

### 1920px · state=error-state

- **Final URL** `http://localhost:4200/login` (5643ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Se connecter
  - `<button>` 182x40 — Créer un compte
  - `<button>` 40x40 — (no text)
- **a11y violations** (3, critical/serious: 0):

### 360px · locale=en

- **Final URL** `http://localhost:4200/login` (2206ms)
- **Undersized touch targets** (1):
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 135px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 360px · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7353ms)
- **Undersized touch targets** (1):
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 132px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414px · locale=en

- **Final URL** `http://localhost:4200/login` (2245ms)
- **Undersized touch targets** (3):
  - `<button>` 165x39 — Sign in
  - `<button>` 165x39 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 126px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414px · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7425ms)
- **Undersized touch targets** (3):
  - `<button>` 165x39 — Sign in
  - `<button>` 165x39 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 123px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 360Lpx · locale=en

- **Final URL** `http://localhost:4200/login` (2204ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Sign in
  - `<button>` 190x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 109px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 360Lpx · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7351ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Sign in
  - `<button>` 190x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 101px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414Lpx · locale=en

- **Final URL** `http://localhost:4200/login` (2236ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Sign in
  - `<button>` 190x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 97px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 414Lpx · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7411ms)
- **Undersized touch targets** (3):
  - `<button>` 190x40 — Sign in
  - `<button>` 190x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 89px — (empty)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/74677422
- **a11y violations** (3, critical/serious: 0):

### 768px · locale=en

- **Final URL** `http://localhost:4200/login` (2315ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 70px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 768px · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7488ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 67px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 1024px · locale=en

- **Final URL** `http://localhost:4200/login` (2346ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 29px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 1024px · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7548ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 26px — (empty)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/74677422
- **a11y violations** (3, critical/serious: 0):

### 1280px · locale=en

- **Final URL** `http://localhost:4200/login` (2315ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg-constellation` clips 13px — (empty)
- **a11y violations** (3, critical/serious: 0):

### 1280px · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7490ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **Console errors** (1):
  - `Failed to load resource: the server responded with a status of 404 (Not Found)`
- **Failed requests** (1):
  - 404 http://localhost:4200/api/documents/small/code/46986414
- **a11y violations** (3, critical/serious: 0):

### 1920px · locale=en

- **Final URL** `http://localhost:4200/login` (2530ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **a11y violations** (3, critical/serious: 0):

### 1920px · state=error-state · locale=en

- **Final URL** `http://localhost:4200/login` (7578ms)
- **Undersized touch targets** (3):
  - `<button>` 182x40 — Sign in
  - `<button>` 182x40 — Create an account
  - `<button>` 40x40 — (no text)
- **a11y violations** (3, critical/serious: 0):

## Decks (list) (02-decks-list)

### 360px

- **Final URL** `http://localhost:4200/decks` (2825ms)
- **Undersized touch targets** (4):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 156x36 — addNouveau deck
  - `<button>` 50x38 — sortRécents
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 1201px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (1, critical/serious: 0):

### 360px · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4273ms)
- **Undersized touch targets** (6):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 156x36 — addNouveau deck
  - `<button>` 50x38 — sortRécents
  - `<button>` 70x32 — Annuler
  - `<button>` 114x38 — deleteSupprimer
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 1201px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 438px — (empty)

### 414px

- **Final URL** `http://localhost:4200/decks` (2620ms)
- **Undersized touch targets** (4):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 157x36 — addNouveau deck
  - `<button>` 50x38 — sortRécents
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 1061px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (1, critical/serious: 0):

### 414px · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4236ms)
- **Undersized touch targets** (6):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 157x36 — addNouveau deck
  - `<button>` 50x38 — sortRécents
  - `<button>` 70x32 — Annuler
  - `<button>` 114x38 — deleteSupprimer
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 1061px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 758px — (empty)

### 360Lpx

- **Final URL** `http://localhost:4200/decks` (2625ms)
- **Undersized touch targets** (4):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 163x36 — addNouveau deck
  - `<button>` 103x38 — sortRécents
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 663px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 279px — (empty)

### 360Lpx · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4189ms)
- **Undersized touch targets** (6):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 163x36 — addNouveau deck
  - `<button>` 103x38 — sortRécents
  - `<button>` 72x32 — Annuler
  - `<button>` 117x38 — deleteSupprimer
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 663px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 279px — (empty)

### 414Lpx

- **Final URL** `http://localhost:4200/decks` (4699ms)
- **Undersized touch targets** (4):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 104x38 — sortRécents
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 609px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 362px — (empty)

### 414Lpx · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4446ms)
- **Undersized touch targets** (6):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 104x38 — sortRécents
  - `<button>` 73x32 — Annuler
  - `<button>` 118x38 — deleteSupprimer
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 609px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 362px — (empty)

### 768px

- **Final URL** `http://localhost:4200/decks` (2754ms)
- **Undersized touch targets** (5):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 162x36 — addNouveau deck
  - `<button>` 103x38 — sortRécents
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 212px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (1, critical/serious: 0):

### 768px · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4306ms)
- **Undersized touch targets** (7):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 162x36 — addNouveau deck
  - `<button>` 103x38 — sortRécents
  - `<button>` 72x32 — Annuler
  - … +1
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 212px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 1858px — (empty)

### 1024px

- **Final URL** `http://localhost:4200/decks` (5526ms)
- **Undersized touch targets** (5):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 105x38 — sortRécents
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 381px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (1, critical/serious: 0):

### 1024px · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4304ms)
- **Undersized touch targets** (7):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 105x38 — sortRécents
  - `<button>` 74x32 — Annuler
  - … +1
- **`overflow:hidden` clipping content** (2):
  - `deck-list` clips 381px — folder_specialMes DecksConstructions enregistréess
  - `div.screen-bg` clips 839px — (empty)

### 1280px

- **Final URL** `http://localhost:4200/decks` (2678ms)
- **Undersized touch targets** (5):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 105x38 — sortRécents
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (1, critical/serious: 0):

### 1280px · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4324ms)
- **Undersized touch targets** (7):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 105x38 — sortRécents
  - `<button>` 74x32 — Annuler
  - … +1
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)

### 1920px

- **Final URL** `http://localhost:4200/decks` (2752ms)
- **Undersized touch targets** (5):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 105x38 — sortRécents
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (1, critical/serious: 0):

### 1920px · state=deck-delete-confirm

- **Final URL** `http://localhost:4200/decks` (4374ms)
- **Undersized touch targets** (7):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<a>` 164x36 — addNouveau deck
  - `<button>` 105x38 — sortRécents
  - `<button>` 74x32 — Annuler
  - … +1
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)

## Deck Builder (03-deck-builder)

### 360px

- **Final URL** `http://localhost:4200/decks/19` (3734ms)
- **Undersized touch targets** (20):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<span>` 86x25 — Firekingfdf
  - `<button>` 44x32 — back_handTest main
  - `<button>` 44x32 — sports_kabaddiDuel PvP
  - `<button>` 44x32 — more_vert
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 376px — (empty)
- **a11y violations** (5, critical/serious: 4):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] button-name** × 2 — Ensure buttons have discernible text
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 414px

- **Final URL** `http://localhost:4200/decks/19` (3510ms)
- **Undersized touch targets** (20):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<span>` 87x25 — Firekingfdf
  - `<button>` 44x32 — back_handTest main
  - `<button>` 44x32 — sports_kabaddiDuel PvP
  - `<button>` 44x32 — more_vert
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 593px — (empty)
- **a11y violations** (5, critical/serious: 4):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] button-name** × 2 — Ensure buttons have discernible text
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 360Lpx

- **Final URL** `http://localhost:4200/decks/19` (3533ms)
- **Undersized touch targets** (20):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<span>` 91x26 — Firekingfdf
  - `<button>` 107x32 — back_handTest main
  - `<button>` 102x32 — sports_kabaddiDuel PvP
  - `<button>` 44x32 — more_vert
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 243px — (empty)
- **a11y violations** (4, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 14 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 414Lpx

- **Final URL** `http://localhost:4200/decks/19` (3629ms)
- **Undersized touch targets** (20):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<span>` 91x26 — Firekingfdf
  - `<button>` 107x32 — back_handTest main
  - `<button>` 103x32 — sports_kabaddiDuel PvP
  - `<button>` 44x32 — more_vert
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 317px — (empty)
- **a11y violations** (4, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 14 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 768px

- **Final URL** `http://localhost:4200/decks/19` (3908ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<span>` 90x26 — Firekingfdf
  - `<button>` 106x32 — back_handTest main
  - `<button>` 102x32 — sports_kabaddiDuel PvP
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (4, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 1024px

- **Final URL** `http://localhost:4200/decks/19` (3659ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<span>` 92x26 — Firekingfdf
  - `<button>` 108x32 — back_handTest main
  - `<button>` 103x32 — sports_kabaddiDuel PvP
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (4, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 1280px

- **Final URL** `http://localhost:4200/decks/19` (3728ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<span>` 92x26 — Firekingfdf
  - `<button>` 109x32 — back_handTest main
  - `<button>` 104x32 — sports_kabaddiDuel PvP
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (4, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 1920px

- **Final URL** `http://localhost:4200/decks/19` (3841ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<span>` 92x26 — Firekingfdf
  - `<button>` 109x32 — back_handTest main
  - `<button>` 104x32 — sports_kabaddiDuel PvP
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (4, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

## Simulator (04-simulator)

### 360px

- **Final URL** `http://localhost:4200/decks/19/simulator` (2820ms)
- **Undersized touch targets** (7):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 19x19 — arrow_back
  - `<button>` 19x19 — refresh
  - `<button>` 19x19 — redo
  - `<button>` 19x19 — undo
  - … +1
- **`overflow:hidden` clipping content** (1):
  - `div.board-container.mobile-layout` clips 350px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 414px

- **Final URL** `http://localhost:4200/decks/19/simulator` (2833ms)
- **Undersized touch targets** (7):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 19x19 — arrow_back
  - `<button>` 19x19 — refresh
  - `<button>` 19x19 — redo
  - `<button>` 19x19 — undo
  - … +1
- **`overflow:hidden` clipping content** (1):
  - `div.board-container.mobile-layout` clips 323px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 360Lpx

- **Final URL** `http://localhost:4200/decks/19/simulator` (2816ms)
- **Undersized touch targets** (7):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 19x19 — arrow_back
  - `<button>` 19x19 — refresh
  - `<button>` 19x19 — redo
  - `<button>` 19x19 — undo
  - … +1
- **`overflow:hidden` clipping content** (1):
  - `div.board-container.mobile-layout` clips 130px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 414Lpx

- **Final URL** `http://localhost:4200/decks/19/simulator` (2819ms)
- **Undersized touch targets** (7):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 19x19 — arrow_back
  - `<button>` 19x19 — refresh
  - `<button>` 19x19 — redo
  - `<button>` 19x19 — undo
  - … +1
- **`overflow:hidden` clipping content** (1):
  - `div.board-container.mobile-layout` clips 82px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 768px

- **Final URL** `http://localhost:4200/decks/19/simulator` (2823ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.board-container` clips 276px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 1024px

- **Final URL** `http://localhost:4200/decks/19/simulator` (2816ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.board-container` clips 148px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 1280px

- **Final URL** `http://localhost:4200/decks/19/simulator` (2823ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.board-container` clips 20px — EMZEMZBanishFieldM1M2M3M4M5GYST1ST2ST3ST4ST5arrow_

### 1920px

- **Final URL** `http://localhost:4200/decks/19/simulator` (2878ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)

## Card Search (05-card-search)

### 360px

- **Final URL** `http://localhost:4200/search` (2743ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 52x21 — Effacer
  - `<button>` 326x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 376px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 360px · state=token-select-open

- **Final URL** `http://localhost:4200/search` (8503ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 52x21 — Effacer
  - `<button>` 326x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 376px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 414px

- **Final URL** `http://localhost:4200/search` (2776ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 52x21 — Effacer
  - `<button>` 380x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 593px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 414px · state=token-select-open

- **Final URL** `http://localhost:4200/search` (8520ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 52x21 — Effacer
  - `<button>` 380x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 593px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 360Lpx

- **Final URL** `http://localhost:4200/search` (2739ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 54x22 — Effacer
  - `<button>` 766x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 243px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 360Lpx · state=token-select-open

- **Final URL** `http://localhost:4200/search` (8489ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 54x22 — Effacer
  - `<button>` 766x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 243px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 414Lpx

- **Final URL** `http://localhost:4200/search` (2732ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 55x22 — Effacer
  - `<button>` 862x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 317px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 414Lpx · state=token-select-open

- **Final URL** `http://localhost:4200/search` (9886ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 36x32 — star_border
  - `<button>` 55x22 — Effacer
  - `<button>` 862x36 — Sélectionner…expand_more
  - `<button>` 36x36 — (no text)
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 317px — (empty)
- **a11y violations** (7, critical/serious: 3):
  - **[critical] aria-required-attr** × 1 — Ensure elements with ARIA roles have all required ARIA attributes
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 768px

- **Final URL** `http://localhost:4200/search` (3123ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (2):
  - `div.screen-bg` clips 1858px — (empty)
  - `main.card-search-page__main` clips 252px — 60+ résultats
- **a11y violations** (6, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 768px · state=token-select-open

- **Final URL** `http://localhost:4200/search` (4244ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (2):
  - `div.screen-bg` clips 1858px — (empty)
  - `main.card-search-page__main` clips 252px — 60+ résultats
- **a11y violations** (8, critical/serious: 4):
  - **[serious] aria-input-field-name** × 1 — Ensure every ARIA input field has an accessible name
  - **[critical] aria-required-children** × 1 — Ensure elements with an ARIA role that require child roles contain them
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 1024px

- **Final URL** `http://localhost:4200/search` (2900ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (6, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 1024px · state=token-select-open

- **Final URL** `http://localhost:4200/search` (4135ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (8, critical/serious: 4):
  - **[serious] aria-input-field-name** × 1 — Ensure every ARIA input field has an accessible name
  - **[critical] aria-required-children** × 1 — Ensure elements with an ARIA role that require child roles contain them
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 1280px

- **Final URL** `http://localhost:4200/search` (2906ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (6, critical/serious: 2):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

### 1280px · state=token-select-open

- **Final URL** `http://localhost:4200/search` (4219ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (8, critical/serious: 4):
  - **[serious] aria-input-field-name** × 1 — Ensure every ARIA input field has an accessible name
  - **[critical] aria-required-children** × 1 — Ensure elements with an ARIA role that require child roles contain them
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 2 — Ensure elements that have scrollable content are accessible by keyboard

### 1920px

- **Final URL** `http://localhost:4200/search` (3078ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (5, critical/serious: 1):
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation

### 1920px · state=token-select-open

- **Final URL** `http://localhost:4200/search` (4397ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 34x32 — view_module
  - `<button>` 34x32 — view_headline
  - `<button>` 36x32 — star_border
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (8, critical/serious: 4):
  - **[serious] aria-input-field-name** × 1 — Ensure every ARIA input field has an accessible name
  - **[critical] aria-required-children** × 1 — Ensure elements with an ARIA role that require child roles contain them
  - **[critical] image-alt** × 7 — Ensure <img> elements have alternative text or a role of none or presentation
  - **[serious] scrollable-region-focusable** × 1 — Ensure elements that have scrollable content are accessible by keyboard

## Preferences (06-preferences)

### 360px

- **Final URL** `http://localhost:4200/preferences` (2727ms)
- **Undersized touch targets** (4):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 138x43 — Français
  - `<button>` 138x43 — English
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px

- **Final URL** `http://localhost:4200/preferences` (2598ms)
- **Undersized touch targets** (4):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 165x43 — Français
  - `<button>` 165x43 — English
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx

- **Final URL** `http://localhost:4200/preferences` (2609ms)
- **Undersized touch targets** (2):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 780px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx

- **Final URL** `http://localhost:4200/preferences` (2597ms)
- **Undersized touch targets** (2):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 906px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px

- **Final URL** `http://localhost:4200/preferences` (2723ms)
- **Undersized touch targets** (5):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 190x44 — Français
  - `<button>` 190x44 — English
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px

- **Final URL** `http://localhost:4200/preferences` (2687ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px

- **Final URL** `http://localhost:4200/preferences` (2699ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px

- **Final URL** `http://localhost:4200/preferences` (2845ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

## Parameters (admin) (07-parameters)

### 360px

- **Final URL** `http://localhost:4200/parameters` (2590ms)
- **Undersized touch targets** (2):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 76776px — (empty)

### 414px

- **Final URL** `http://localhost:4200/parameters` (2636ms)
- **Undersized touch targets** (2):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 11625px — (empty)

### 360Lpx

- **Final URL** `http://localhost:4200/parameters` (2555ms)
- **Undersized touch targets** (2):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1529px — (empty)

### 414Lpx

- **Final URL** `http://localhost:4200/parameters` (2585ms)
- **Undersized touch targets** (2):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1792px — (empty)

### 768px

- **Final URL** `http://localhost:4200/parameters` (2660ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)

### 1024px

- **Final URL** `http://localhost:4200/parameters` (2667ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1572px — (empty)

### 1280px

- **Final URL** `http://localhost:4200/parameters` (2743ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 2099px — (empty)

### 1920px

- **Final URL** `http://localhost:4200/parameters` (2900ms)
- **Undersized touch targets** (3):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)

## PvP Lobby (08-pvp-lobby)

### 360px

- **Final URL** `http://localhost:4200/pvp` (8072ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 131x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9762ms)
- **Undersized touch targets** (13):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 131x38 — sortPlus récentes
  - `<app-bottom-sheet-handle>` 358x28 — (no text)
  - `<button>` 44x24 — (no text)
  - `<button>` 30x32 — 1m
  - … +7
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9706ms)
- **Undersized touch targets** (6):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 131x38 — sortPlus récentes
  - `<app-bottom-sheet-handle>` 358x28 — (no text)
  - `<button>` 89x40 — Annuler
  - `<button>` 237x40 — Créer la room
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px

- **Final URL** `http://localhost:4200/pvp` (8075ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 131x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9779ms)
- **Undersized touch targets** (13):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 131x38 — sortPlus récentes
  - `<app-bottom-sheet-handle>` 412x28 — (no text)
  - `<button>` 44x24 — (no text)
  - `<button>` 30x32 — 1m
  - … +7
- **Truncated texts** (4):
  - `<span>` [text-overflow:ellipsis] — Radiant Typhoon
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
  - `<span>` [text-overflow:ellipsis] — Branded Dracotail
  - `<span>` [text-overflow:ellipsis] — created by skytrix
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9737ms)
- **Undersized touch targets** (6):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 131x38 — sortPlus récentes
  - `<app-bottom-sheet-handle>` 412x28 — (no text)
  - `<button>` 90x40 — Annuler
  - `<button>` 290x40 — Créer la room
- **Truncated texts** (4):
  - `<span>` [text-overflow:ellipsis] — Radiant Typhoon
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
  - `<span>` [text-overflow:ellipsis] — Branded Dracotail
  - `<span>` [text-overflow:ellipsis] — created by skytrix
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx

- **Final URL** `http://localhost:4200/pvp` (10829ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 136x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 708px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9803ms)
- **Undersized touch targets** (10):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 136x38 — sortPlus récentes
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - `<button>` 33x32 — 3m
  - … +4
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 708px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9695ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 136x38 — sortPlus récentes
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 708px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx

- **Final URL** `http://localhost:4200/pvp` (8096ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 137x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 794px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9755ms)
- **Undersized touch targets** (10):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 137x38 — sortPlus récentes
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - `<button>` 33x32 — 3m
  - … +4
- **Truncated texts** (3):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
  - `<span>` [text-overflow:ellipsis] — Branded Dracotail
  - `<span>` [text-overflow:ellipsis] — created by skytrix
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 794px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (10010ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 137x38 — sortPlus récentes
- **Truncated texts** (3):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
  - `<span>` [text-overflow:ellipsis] — Branded Dracotail
  - `<span>` [text-overflow:ellipsis] — created by skytrix
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 794px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px

- **Final URL** `http://localhost:4200/pvp` (8188ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 135x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9804ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 135x38 — sortPlus récentes
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9806ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 135x38 — sortPlus récentes
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px

- **Final URL** `http://localhost:4200/pvp` (8130ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 843px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9830ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 843px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9791ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 843px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px

- **Final URL** `http://localhost:4200/pvp` (8168ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (9925ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9794ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px

- **Final URL** `http://localhost:4200/pvp` (8338ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · state=sandbox-dialog

- **Final URL** `http://localhost:4200/pvp` (10157ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · state=create-room-dialog

- **Final URL** `http://localhost:4200/pvp` (9997ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 138x38 — sortPlus récentes
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · locale=en

- **Final URL** `http://localhost:4200/pvp` (8066ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 123x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (11781ms)
- **Undersized touch targets** (13):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 123x38 — sortNewest first
  - `<app-bottom-sheet-handle>` 358x28 — (no text)
  - `<button>` 44x24 — (no text)
  - `<button>` 30x32 — 1m
  - … +7
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (14848ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 123x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px · locale=en

- **Final URL** `http://localhost:4200/pvp` (8118ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 124x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (11754ms)
- **Undersized touch targets** (13):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 124x38 — sortNewest first
  - `<app-bottom-sheet-handle>` 412x28 — (no text)
  - `<button>` 44x24 — (no text)
  - `<button>` 30x32 — 1m
  - … +7
- **Truncated texts** (4):
  - `<span>` [text-overflow:ellipsis] — Radiant Typhoon
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
  - `<span>` [text-overflow:ellipsis] — Branded Dracotail
  - `<span>` [text-overflow:ellipsis] — created by skytrix
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (14823ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 124x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx · locale=en

- **Final URL** `http://localhost:4200/pvp` (8069ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 128x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 667px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (11725ms)
- **Undersized touch targets** (10):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 128x38 — sortNewest first
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - `<button>` 33x32 — 3m
  - … +4
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 667px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (14821ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 128x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 667px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · locale=en

- **Final URL** `http://localhost:4200/pvp` (8071ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 128x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 748px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (11768ms)
- **Undersized touch targets** (10):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 128x38 — sortNewest first
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - `<button>` 33x32 — 3m
  - … +4
- **Truncated texts** (3):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
  - `<span>` [text-overflow:ellipsis] — Branded Dracotail
  - `<span>` [text-overflow:ellipsis] — created by skytrix
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 748px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (14854ms)
- **Undersized touch targets** (3):
  - `<button>` 247x38 — English
  - `<button>` 247x32 — Log out
  - `<button>` 128x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 748px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px · locale=en

- **Final URL** `http://localhost:4200/pvp` (8137ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 127x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (11831ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 127x38 — sortNewest first
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (14981ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 127x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1858px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px · locale=en

- **Final URL** `http://localhost:4200/pvp` (8152ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (11849ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (14945ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · locale=en

- **Final URL** `http://localhost:4200/pvp` (8437ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (12002ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (15026ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · locale=en

- **Final URL** `http://localhost:4200/pvp` (8407ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · state=sandbox-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (12373ms)
- **Undersized touch targets** (11):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
  - `<button>` 44x24 — (no text)
  - `<button>` 31x32 — 1m
  - … +5
- **Truncated texts** (1):
  - `<span>` [text-overflow:ellipsis] — Snake-Eye Yummy Sarcophagus (Hollywood WCQ)
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (2, critical/serious: 2):
  - **[serious] aria-dialog-name** × 1 — Ensure every ARIA dialog and alertdialog node has an accessible name
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · state=create-room-dialog · locale=en

- **Final URL** `http://localhost:4200/pvp` (15206ms)
- **Undersized touch targets** (4):
  - `<button>` 227x38 — English
  - `<button>` 227x32 — Log out
  - `<button>` 32x32 — (no text)
  - `<button>` 130x38 — sortNewest first
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

## Replay Hub (09-replay-hub)

### 360px

- **Final URL** `http://localhost:4200/pvp/history` (2860ms)
- **Undersized touch targets** (17):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 42x42 — arrow_backLobby
  - `<button>` 55x32 — Tous
  - `<button>` 97x32 — emoji_eventsVictoires
  - `<button>` 94x32 — closeDéfaites
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 5 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5137ms)
- **Undersized touch targets** (20):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 42x42 — arrow_backLobby
  - `<button>` 55x32 — Tous
  - `<button>` 97x32 — emoji_eventsVictoires
  - `<button>` 94x32 — closeDéfaites
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 438px — (empty)
- **a11y violations** (3, critical/serious: 1):
  - **[serious] color-contrast** × 5 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px

- **Final URL** `http://localhost:4200/pvp/history` (2844ms)
- **Undersized touch targets** (18):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 42x42 — arrow_backLobby
  - `<button>` 56x32 — Tous
  - `<button>` 97x32 — emoji_eventsVictoires
  - `<button>` 94x32 — closeDéfaites
  - … +12
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 5 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414px · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5146ms)
- **Undersized touch targets** (20):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 42x42 — arrow_backLobby
  - `<button>` 56x32 — Tous
  - `<button>` 97x32 — emoji_eventsVictoires
  - `<button>` 94x32 — closeDéfaites
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 758px — (empty)
- **a11y violations** (3, critical/serious: 1):
  - **[serious] color-contrast** × 5 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx

- **Final URL** `http://localhost:4200/pvp/history` (2761ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 57x32 — Tous
  - `<button>` 100x32 — emoji_eventsVictoires
  - `<button>` 96x32 — closeDéfaites
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 279px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360Lpx · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5083ms)
- **Undersized touch targets** (17):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 57x32 — Tous
  - `<button>` 100x32 — emoji_eventsVictoires
  - `<button>` 96x32 — closeDéfaites
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 279px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx

- **Final URL** `http://localhost:4200/pvp/history` (2815ms)
- **Undersized touch targets** (14):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 57x32 — Tous
  - `<button>` 100x32 — emoji_eventsVictoires
  - `<button>` 97x32 — closeDéfaites
  - … +8
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 362px — (empty)
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5168ms)
- **Undersized touch targets** (17):
  - `<button>` 247x38 — Français
  - `<button>` 247x32 — Se déconnecter
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 57x32 — Tous
  - `<button>` 100x32 — emoji_eventsVictoires
  - `<button>` 97x32 — closeDéfaites
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 362px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px

- **Final URL** `http://localhost:4200/pvp/history` (2918ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 57x32 — Tous
  - `<button>` 100x32 — emoji_eventsVictoires
  - … +14
- **`overflow:hidden` clipping content** (11):
  - `div.screen-bg` clips 1858px — (empty)
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle héro masqué vs héro masqué timer_of
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle Radiant Typhoon vs Radiant Typhoon 
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle Radiant Typhoon vs Radiant Typhoon 
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle héro masqué vs héro masqué timer_of
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle Fireking vs Fireking timer_offTimeo
  - … +5
- **a11y violations** (1, critical/serious: 0):

### 768px · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5250ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 57x32 — Tous
  - `<button>` 100x32 — emoji_eventsVictoires
  - … +14
- **`overflow:hidden` clipping content** (11):
  - `div.screen-bg` clips 1858px — (empty)
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle héro masqué vs héro masqué timer_of
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle Radiant Typhoon vs Radiant Typhoon 
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle Radiant Typhoon vs Radiant Typhoon 
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle héro masqué vs héro masqué timer_of
  - `a.replay-card.surface-card` clips 20px — A vsadminstyle Fireking vs Fireking timer_offTimeo
  - … +5
- **a11y violations** (2, critical/serious: 0):

### 1024px

- **Final URL** `http://localhost:4200/pvp/history` (2979ms)
- **Undersized touch targets** (17):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 58x32 — Tous
  - `<button>` 101x32 — emoji_eventsVictoires
  - … +11
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1024px · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5336ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 58x32 — Tous
  - `<button>` 101x32 — emoji_eventsVictoires
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 839px — (empty)
- **a11y violations** (3, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px

- **Final URL** `http://localhost:4200/pvp/history` (3113ms)
- **Undersized touch targets** (18):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 58x32 — Tous
  - `<button>` 102x32 — emoji_eventsVictoires
  - … +12
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5498ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 58x32 — Tous
  - `<button>` 102x32 — emoji_eventsVictoires
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 1241px — (empty)
- **a11y violations** (3, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px

- **Final URL** `http://localhost:4200/pvp/history` (3294ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 58x32 — Tous
  - `<button>` 102x32 — emoji_eventsVictoires
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (2, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · state=replay-sort-menu

- **Final URL** `http://localhost:4200/pvp/history` (5612ms)
- **Undersized touch targets** (20):
  - `<button>` 227x38 — Français
  - `<button>` 227x32 — Se déconnecter
  - `<button>` 32x32 — (no text)
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 58x32 — Tous
  - `<button>` 102x32 — emoji_eventsVictoires
  - … +14
- **`overflow:hidden` clipping content** (1):
  - `div.screen-bg` clips 7344px — (empty)
- **a11y violations** (3, critical/serious: 1):
  - **[serious] color-contrast** × 3 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

## Replay Viewer (10-replay-viewer)

### 360px

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3993ms)
- **Undersized touch targets** (6):
  - `<button>` 50x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 71x24 — infoDétails
  - `<button>` 79x25 — Tour 1DP
  - `<button>` 32x32 — download
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (1):
  - `app-replay-page.is-narrow` clips 32px — Tournez votre appareil en paysagearrow_backLobby A
- **a11y violations** (1, critical/serious: 0):

### 414px

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3565ms)
- **Undersized touch targets** (6):
  - `<button>` 50x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 71x24 — infoDétails
  - `<button>` 79x25 — Tour 1DP
  - `<button>` 32x32 — download
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (1):
  - `app-replay-page.is-narrow` clips 36px — Tournez votre appareil en paysagearrow_backLobby A
- **a11y violations** (1, critical/serious: 0):

### 360Lpx

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3627ms)
- **Undersized touch targets** (7):
  - `<button>` 80x26 — Tour 1DP
  - `<button>` 77x32 — animationAnim.
  - `<button>` 80x32 — messageDécis.
  - `<button>` 66x34 — P1 swap_horiz
  - `<button>` 44x32 — fork_rightForker
  - `<button>` 32x32 — download
  - … +1
- **a11y violations** (2, critical/serious: 0):

### 414Lpx

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (4082ms)
- **Undersized touch targets** (7):
  - `<button>` 81x26 — Tour 1DP
  - `<button>` 78x32 — animationAnim.
  - `<button>` 80x32 — messageDécis.
  - `<button>` 66x34 — P1 swap_horiz
  - `<button>` 44x32 — fork_rightForker
  - `<button>` 32x32 — download
  - … +1
- **a11y violations** (2, critical/serious: 0):

### 768px

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (4163ms)
- **Undersized touch targets** (9):
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 80x26 — Tour 1DP
  - `<button>` 77x32 — animationAnim.
  - `<button>` 80x32 — messageDécis.
  - `<button>` 66x34 — P1 swap_horiz
  - … +3
- **`overflow:hidden` clipping content** (1):
  - `app-replay-page` clips 68px — Tournez votre appareil en paysagearrow_backLobby A
- **a11y violations** (1, critical/serious: 0):

### 1024px

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3743ms)
- **Undersized touch targets** (13):
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Tour 1DP
  - `<button>` 29x18 — 1×
  - `<button>` 31x18 — 2×
  - `<button>` 31x18 — 3×
  - … +7
- **a11y violations** (2, critical/serious: 0):

### 1280px

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (4184ms)
- **Undersized touch targets** (13):
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Tour 1DP
  - `<button>` 29x18 — 1×
  - `<button>` 31x18 — 2×
  - `<button>` 31x18 — 3×
  - … +7
- **a11y violations** (2, critical/serious: 0):

### 1920px

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (4135ms)
- **Undersized touch targets** (13):
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Tour 1DP
  - `<button>` 29x18 — 1×
  - `<button>` 31x18 — 2×
  - `<button>` 31x18 — 3×
  - … +7
- **a11y violations** (2, critical/serious: 0):

### 360px · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3589ms)
- **Undersized touch targets** (6):
  - `<button>` 50x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 71x24 — infoDetails
  - `<button>` 80x25 — Turn 1DP
  - `<button>` 32x32 — download
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (1):
  - `app-replay-page.is-narrow` clips 32px — Rotate your device to landscapearrow_backLobby A a
- **a11y violations** (1, critical/serious: 0):

### 414px · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3626ms)
- **Undersized touch targets** (6):
  - `<button>` 50x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 71x24 — infoDetails
  - `<button>` 80x25 — Turn 1DP
  - `<button>` 32x32 — download
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (1):
  - `app-replay-page.is-narrow` clips 36px — Rotate your device to landscapearrow_backLobby A a
- **a11y violations** (1, critical/serious: 0):

### 360Lpx · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3592ms)
- **Undersized touch targets** (7):
  - `<button>` 81x26 — Turn 1DP
  - `<button>` 77x32 — animationAnim.
  - `<button>` 99x32 — messageDecisions
  - `<button>` 66x34 — P1 swap_horiz
  - `<button>` 44x32 — fork_rightFork
  - `<button>` 32x32 — download
  - … +1
- **a11y violations** (2, critical/serious: 0):

### 414Lpx · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3634ms)
- **Undersized touch targets** (7):
  - `<button>` 81x26 — Turn 1DP
  - `<button>` 78x32 — animationAnim.
  - `<button>` 99x32 — messageDecisions
  - `<button>` 66x34 — P1 swap_horiz
  - `<button>` 44x32 — fork_rightFork
  - `<button>` 32x32 — download
  - … +1
- **a11y violations** (2, critical/serious: 0):

### 768px · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3617ms)
- **Undersized touch targets** (9):
  - `<button>` 92x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Turn 1DP
  - `<button>` 77x32 — animationAnim.
  - `<button>` 98x32 — messageDecisions
  - `<button>` 66x34 — P1 swap_horiz
  - … +3
- **`overflow:hidden` clipping content** (1):
  - `app-replay-page` clips 68px — Rotate your device to landscapearrow_backLobby A a
- **a11y violations** (1, critical/serious: 0):

### 1024px · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3769ms)
- **Undersized touch targets** (13):
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Turn 1DP
  - `<button>` 29x18 — 1×
  - `<button>` 31x18 — 2×
  - `<button>` 31x18 — 3×
  - … +7
- **a11y violations** (2, critical/serious: 0):

### 1280px · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3839ms)
- **Undersized touch targets** (13):
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Turn 1DP
  - `<button>` 29x18 — 1×
  - `<button>` 31x18 — 2×
  - `<button>` 31x18 — 3×
  - … +7
- **a11y violations** (2, critical/serious: 0):

### 1920px · locale=en

- **Final URL** `http://localhost:4200/pvp/replay/ffdd5fc0-3937-465d-9dd6-b75d5ce5e36a` (3972ms)
- **Undersized touch targets** (13):
  - `<button>` 93x38 — arrow_backLobby
  - `<button>` 34x34 — link
  - `<button>` 81x26 — Turn 1DP
  - `<button>` 29x18 — 1×
  - `<button>` 31x18 — 2×
  - `<button>` 31x18 — 3×
  - … +7
- **a11y violations** (2, critical/serious: 0):

## Duel in-game (fork-solo) (11-duel-ingame)

### 360px

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15580ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 50px — Tournez votre appareil en paysageConnexion perdueI
  - `div.skel-hand-card` clips 60px — (empty)
  - `div.skel-hand-card` clips 60px — (empty)
  - `div.skel-hand-card` clips 60px — (empty)
  - `div.skel-hand-card` clips 60px — (empty)
  - `div.skel-hand-card` clips 60px — (empty)
  - … +9

### 414px

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15570ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 56px — Tournez votre appareil en paysageConnexion perdueI
  - `div.skel-hand-card` clips 71px — (empty)
  - `div.skel-hand-card` clips 71px — (empty)
  - `div.skel-hand-card` clips 71px — (empty)
  - `div.skel-hand-card` clips 71px — (empty)
  - `div.skel-hand-card` clips 71px — (empty)
  - … +9

### 360Lpx

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15561ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 32px — Connexion perdueImpossible de joindre le serveur R
  - `div.skel-hand-card` clips 43px — (empty)
  - `div.skel-hand-card` clips 43px — (empty)
  - `div.skel-hand-card` clips 43px — (empty)
  - `div.skel-hand-card` clips 43px — (empty)
  - `div.skel-hand-card` clips 43px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15548ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 28px — Connexion perdueImpossible de joindre le serveur R
  - `div.skel-hand-card` clips 49px — (empty)
  - `div.skel-hand-card` clips 49px — (empty)
  - `div.skel-hand-card` clips 49px — (empty)
  - `div.skel-hand-card` clips 49px — (empty)
  - `div.skel-hand-card` clips 49px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15587ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 65px — Tournez votre appareil en paysageConnexion perdueI
  - `div.skel-hand-card` clips 123px — (empty)
  - `div.skel-hand-card` clips 123px — (empty)
  - `div.skel-hand-card` clips 123px — (empty)
  - `div.skel-hand-card` clips 123px — (empty)
  - `div.skel-hand-card` clips 123px — (empty)
  - … +9

### 1024px

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15584ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 48px — Connexion perdueImpossible de joindre le serveur R
  - `div.skel-hand-card` clips 86px — (empty)
  - `div.skel-hand-card` clips 86px — (empty)
  - `div.skel-hand-card` clips 86px — (empty)
  - `div.skel-hand-card` clips 86px — (empty)
  - `div.skel-hand-card` clips 86px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15582ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 50px — Connexion perdueImpossible de joindre le serveur R
  - `div.skel-hand-card` clips 87px — (empty)
  - `div.skel-hand-card` clips 87px — (empty)
  - `div.skel-hand-card` clips 87px — (empty)
  - `div.skel-hand-card` clips 87px — (empty)
  - `div.skel-hand-card` clips 87px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15617ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 68px — Connexion perdueImpossible de joindre le serveur R
  - `div.skel-hand-card` clips 122px — (empty)
  - `div.skel-hand-card` clips 122px — (empty)
  - `div.skel-hand-card` clips 122px — (empty)
  - `div.skel-hand-card` clips 122px — (empty)
  - `div.skel-hand-card` clips 122px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 360px · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15555ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 50px — Rotate your device to landscapeConnection lostUnab
  - `div.skel-hand-card` clips 61px — (empty)
  - `div.skel-hand-card` clips 61px — (empty)
  - `div.skel-hand-card` clips 61px — (empty)
  - `div.skel-hand-card` clips 61px — (empty)
  - `div.skel-hand-card` clips 61px — (empty)
  - … +9

### 414px · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15566ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 56px — Rotate your device to landscapeConnection lostUnab
  - `div.skel-hand-card` clips 70px — (empty)
  - `div.skel-hand-card` clips 70px — (empty)
  - `div.skel-hand-card` clips 70px — (empty)
  - `div.skel-hand-card` clips 70px — (empty)
  - `div.skel-hand-card` clips 70px — (empty)
  - … +9

### 360Lpx · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15546ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 32px — Connection lostUnable to reach the server Back to 
  - `div.skel-hand-card` clips 42px — (empty)
  - `div.skel-hand-card` clips 42px — (empty)
  - `div.skel-hand-card` clips 42px — (empty)
  - `div.skel-hand-card` clips 42px — (empty)
  - `div.skel-hand-card` clips 42px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 414Lpx · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15551ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 28px — Connection lostUnable to reach the server Back to 
  - `div.skel-hand-card` clips 48px — (empty)
  - `div.skel-hand-card` clips 48px — (empty)
  - `div.skel-hand-card` clips 48px — (empty)
  - `div.skel-hand-card` clips 48px — (empty)
  - `div.skel-hand-card` clips 48px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 768px · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15571ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 65px — Rotate your device to landscapeConnection lostUnab
  - `div.skel-hand-card` clips 121px — (empty)
  - `div.skel-hand-card` clips 121px — (empty)
  - `div.skel-hand-card` clips 121px — (empty)
  - `div.skel-hand-card` clips 121px — (empty)
  - `div.skel-hand-card` clips 121px — (empty)
  - … +9

### 1024px · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15570ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 48px — Connection lostUnable to reach the server Back to 
  - `div.skel-hand-card` clips 90px — (empty)
  - `div.skel-hand-card` clips 90px — (empty)
  - `div.skel-hand-card` clips 90px — (empty)
  - `div.skel-hand-card` clips 90px — (empty)
  - `div.skel-hand-card` clips 90px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1280px · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15578ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 50px — Connection lostUnable to reach the server Back to 
  - `div.skel-hand-card` clips 84px — (empty)
  - `div.skel-hand-card` clips 84px — (empty)
  - `div.skel-hand-card` clips 84px — (empty)
  - `div.skel-hand-card` clips 84px — (empty)
  - `div.skel-hand-card` clips 84px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds

### 1920px · locale=en

- **Final URL** `http://localhost:4200/pvp/duel/YBLWKZ` (15617ms)
- **Undersized touch targets** (3):
  - `<button>` 32x32 — download
  - `<button>` 32x32 — delete_outline
  - `<button>` 32x32 — close
- **`overflow:hidden` clipping content** (15):
  - `div.duel-container` clips 68px — Connection lostUnable to reach the server Back to 
  - `div.skel-hand-card` clips 125px — (empty)
  - `div.skel-hand-card` clips 125px — (empty)
  - `div.skel-hand-card` clips 125px — (empty)
  - `div.skel-hand-card` clips 125px — (empty)
  - `div.skel-hand-card` clips 125px — (empty)
  - … +9
- **a11y violations** (1, critical/serious: 1):
  - **[serious] color-contrast** × 1 — Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds
