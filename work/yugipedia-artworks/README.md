# Artworks alternatifs depuis Yugipedia — note de reprise

État au 2026-11-24 : **implémenté (option B), pas encore lancé sur la vraie base ni commité.**

- Code : `back/src/main/java/com/skytrix/service/artwork/` (`YugipediaArtworkService`, `YugipediaArtworkParser`,
  `CardScanImages`), `YugipediaRequester` (`fetchPageTitles`, `fetchWikitexts`, `fetchFileUrls`, `downloadFile`),
  migration `V020__yugipedia_artworks.sql` (`card_image.source`, `card_image.source_file`,
  `card.yugipedia_artworks_checked`).
- Déclenchement : bouton « Images originales » (tâche `images`) ; 2ᵉ phase après le téléchargement des images
  YGOPRODeck manquantes (`YugiproApiService.fetchAllMissingImageAndSave`). La barre de progression repart à zéro
  pour cette phase (total = cartes non vérifiées).
- Les flux YGOPRODeck (`findYgoproImages…`, `refreshCardImages`) ignorent les lignes `YUGIPEDIA` ; image par défaut
  = `Card.getMainImage()` ; `Card.images` trié par id.
- Hash Java validé contre le prototype : mêmes décisions sur les 86 cartes multi-artworks. Essai réel (Ash Blossom,
  Dragon Master Magia) : wikitext, URLs, téléchargement et traitement B OK.
- **Mises à jour** (migration `V021__yugipedia_artworks_recheck.sql`, remplace le booléen de V020) :
  `card.yugipedia_artworks_checked_at` + `card.yugipedia_artwork_count`. À chaque synchro : cartes jamais vérifiées,
  puis cartes vérifiées dont la page Yugipedia a été modifiée depuis la dernière synchro (= max de `checked_at`,
  moins 1 jour de marge ; requête SMW `[[Modification date::>…]]`, ~70 pages/jour, 1 requête). Une page modifiée
  n'est retéléchargée que si elle liste plus d'artworks qu'au dernier passage. Peu de nouvelles cartes (≤ 100) :
  titres cherchés par passcode (`[[Password::a||b]]`, 10 par requête, mot de passe sur 8 chiffres) au lieu des
  ~30 requêtes du pool complet.
- Revérifier une carte à la main : `card.yugipedia_artworks_checked_at = NULL`.
- Limite connue : si YGOPRODeck ajoute plus tard un artwork déjà importé depuis Yugipedia, la carte l'a en double
  (l'image Yugipedia peut être sélectionnée dans un deck, pas de suppression automatique).

## Objectif

YGOPRODeck n'a pas tous les artworks d'une carte (artworks alternatifs, full arts). Yugipedia les recense. On veut
**ajouter** les artworks manquants comme `CardImage` supplémentaires, sans toucher aux images YGOPRODeck existantes.
La langue du scan importe peu : l'anglais suffit (décision utilisateur). Les images FR ont été écartées : trop peu de
scans FR existent (Dragon Master Magia : aucun, Ash Blossom : 7 fichiers réels sur 39 listés).

## Ce qu'on sait de Yugipedia

- API : `https://yugipedia.com/api.php` (MediaWiki + Semantic MediaWiki), derrière **Cloudflare**. Une rafale
  (~17 requêtes à 1 req/s) renvoie une page de challenge HTML en 200/403 au lieu du JSON. **3 s entre requêtes** passe
  sans blocage ; prévoir une pause longue (90 s) et une reprise si on reçoit du HTML.
- User-Agent descriptif (`SkytrixCardSync/1.0 (...)`), comme dans `YugipediaRequester`.
- **Liste des artworks d'une carte** : paramètre `image` du `CardTable2` dans le wikitext de la page de la carte
  (`action=query&prop=revisions&rvprop=content&rvslots=main&titles=A|B|…`, **50 titres par requête**). Deux formats :
  - artwork unique : `| image = PaleozoicAnomalocaris-MP25-EN-PScR-1E.png`
  - plusieurs : une ligne par artwork, `N; scan.png; illustration-seule.png` ; `N.1` = même artwork N, scan d'une autre
    région (souvent EN quand N est JP). Commentaires `<!-- … -->` à retirer (ex. Dark Magician : artwork 3 = Arkana,
    omis volontairement).
  - Exemple Dragon Master Magia : `1` QCDB-JP-UR, `1.1` RA04-EN-PlScR, `2` LOSP-JP-PScR (full art), `2.1`
    BLGG-EN-UR-1E (full art).
- Les pages `Card Gallery:<nom>` listent les **impressions**, pas les artworks, et contiennent beaucoup de liens rouges
  (fichiers inexistants). Ne pas s'en servir pour les artworks.
- La propriété SMW `French image` ne concerne que les pages de jeux vidéo : inutile.
- **URLs des fichiers** : `action=query&prop=imageinfo&iiprop=url|size&titles=File:A|File:B|…` (50 par requête).
  **`iiurlwidth` est refusé** (`thumbsize-blocked` : pas de miniatures générées pour les clients externes). L'URL
  `img.yugipedia.com/thumb/...` répond, mais va contre leur demande explicite : télécharger les **originaux**
  (`img.yugipedia.com/x/xy/Fichier.png`, ~1 Mo en moyenne, jusqu'à 1,8 Mo) et réduire chez nous.
- `img.yugipedia.com` n'a pas montré de challenge Cloudflare (contrairement à `api.php`).
- Le titre de page d'une carte vient de la requête SMW déjà utilisée pour les traductions
  (`[[Concept:CG cards]]…|?Password`, clé `fulltext` de chaque résultat) : à conserver lors de la synchro FR.
- Contenu sous licence CC BY-SA ; les scans eux-mêmes sont des images Konami.

## Résultats du prototype (157 cartes)

Échantillon : 82 cartes ayant plusieurs images chez YGOPRODeck (sur 125 dans tout le catalogue ; les autres n'avaient
pas de titre Yugipedia dans le pool FR) + 75 cartes à image unique tirées au hasard (graine 42).

- Artworks listés par Yugipedia : 308 ; tous les scans désignés par le paramètre `image` existent (0 lien rouge).
- Langue des scans retenus (EN préféré) : EN 259, JP 37, NA 9, KR 2, EU 1.
- **Correspondance par hash** (dHash 16×16 = 256 bits, sur la zone d'illustration recadrée aux proportions d'un cadre
  standard `left .12, top .185, right .88, bottom .70`, niveaux de gris normalisés ; images YGOPRODeck `cards_small`) :
  - même artwork : distance ≤ 90 ; artworks différents : ≥ 102. **Seuil retenu : 95.** (75 faisait passer Taunt,
    d = 90, pour un nouvel artwork.)
  - règle : chaque image YGOPRODeck va vers l'artwork Yugipedia le plus proche si d ≤ 95 (plusieurs images YGOPRODeck
    peuvent pointer le même artwork — Toon World, Gilford ont deux `imageId` pour un même dessin). Un artwork
    Yugipedia que rien ne vise = **nouvel artwork**. Pas d'appariement un-pour-un (c'était l'erreur du 1er essai).
  - 174 images YGOPRODeck sur 185 associées ; les 11 restantes sont des artworks que Yugipedia ne liste pas
    (Ring of Destruction aux flammes, ancien Polymerization, Taunt à l'homme et au vieillard…) → on garde l'image
    YGOPRODeck, rien à faire.
- **Nouveaux artworks** : 75, dont **39 avec scan EN sur 30 cartes** (multi-artworks : Blue-Eyes +4, Dark Magician
  Girl +4, I:P Masquerena +2, Tour Guide +2, Winged Kuriboh +2, Ash Blossom +1, full arts BLGG…). Vérifiés à l'œil
  comme vrais nouveaux : Arcana Knight Joker (armure blanche), Number 34 (fond blanc), Crush Card Virus (fond beige),
  Gilford (Speed Duel SBC2).
- Cartes à image unique : 4 sur 75 gagnent un artwork (Accesscode Talker, Dominus Impulse, Deep-Eyes White Dragon,
  Audhumla). Extrapolation large : **~500 à 1 000 cartes** du catalogue gagneraient au moins un artwork.
- **Écarter les scans JP/KR** (36 nouveaux artworks) : vieux cadres JP à mise en page différente → recadrage faux →
  faux « nouveaux » artworks (ex. Summoned Skull art 2, `SummonedSkull-T3-JP-UR.png`, d = 117 contre la même image
  YGOPRODeck 70781053), et texte japonais.
- Piste non testée pour fiabiliser : comparer l'**illustration seule** (2ᵉ colonne du paramètre `image`, quand elle
  existe) avec `image_url_cropped` de YGOPRODeck, indépendamment du cadre.

## Images FR — mis de côté (décision utilisateur 2026-11-24, « on fera plus tard »)

- Pas de catégorie de scans FR. Source possible : les **706 galeries de sets français**
  (`Category:French Set Card Galleries`, pages `Set Card Galleries:<set> (TCG-FR-1E|UE|LE)`), lisibles par
  `generator=images&gimlimit=500&prop=imageinfo` (1 requête par galerie, ~35 min à 3 s).
- Couverture très inégale : échantillon de 12 galeries = **164 fichiers réels sur 402 listés (41 %)** ; de 0 % (Rage of
  the Abyss 0/125, sets récents) à 100 % (Hidden Arsenal 6, Magical Hero).
- Rattacher un scan FR à son artwork : même hash que pour les artworks EN (les deux sont des scans au cadre TCG).

## Duel : artwork choisi dans la decklist

Déjà en place côté front : `DuelLoadingEffectsService.buildArtMap()` lit la decklist du joueur et associe
passcode → `smallUrl` de l'image choisie (`selectedImageId`) ; `DuelCardArtService.resolveUrl` s'en sert, sinon
`/api/documents/small/code/{passcode}` (= `card.getImages().get(0)`, ordre non garanti). Les nouveaux `CardImage`
s'y brancheront sans changement. Limites actuelles : une seule image par passcode (3 exemplaires aux artworks
différents → un seul affiché) ; l'adversaire voit l'artwork par défaut, pas celui choisi par le joueur.

## Coût estimé d'une synchro complète

- Wikitext : ~14 000 cartes / 50 = ~280 requêtes `api.php` → ~15 min à 3 s.
- Scans : seulement pour les cartes où Yugipedia liste plus d'artworks que YGOPRODeck, ou dont YGOPRODeck a
  plusieurs images → ~2 000 originaux ≈ **2 Go, une fois**. Stockage final réduit (421 px + petite version).
- Ensuite : incrémental (nouvelles cartes seulement).

## Affichage retenu : option B (décision utilisateur 2026-11-24)

Options étudiées (aperçu fait avec Ash Blossom art 3 « 無効です » et le full art de Dragon Master Magia) :
- A : scan brut redimensionné (garde les full arts, style « vraie carte » plus terne, vignette sombre) ;
- **B (retenue)** : A + recadrage des bords, ratio exact de nos images, légère correction luminosité/contraste,
  scan le moins holo quand le paramètre `image` en propose plusieurs (`N` / `N.1`) ;
- C : illustration du scan collée dans le rendu YGOPRODeck (indiscernable pour un cadre normal, mais **détruit les
  full arts** et demande des coordonnées par type de cadre Pendule/Link) — éventuelle amélioration ultérieure.

Pièges : forcer l'ordre des images (`@OrderBy` ou image principale marquée) pour que `get(0)` reste l'image
YGOPRODeck ; images servies `immutable` 1 an → ne jamais remplacer un fichier sous le même identifiant.
Coût stockage : `images/big` ≈ 2,3 Go (≈ 180 Ko par image) ; +0,2 à 0,4 Go attendus.

## Plan d'implémentation proposé (validé sur le principe par l'utilisateur, pas commencé)

1. Garder le titre de page Yugipedia par passcode lors de la synchro FR (ou le redemander).
2. Nouvelle tâche de synchro séparée et pausable (`SyncTaskTracker`, comme `fetchAllMissingImageAndSave`) :
   wikitext par lots de 50 → parse du paramètre `image` → filtre (Yugipedia > YGOPRODeck, ou YGOPRODeck multi) →
   `imageinfo` par lots de 50 → téléchargement des originaux EN → hash → nouveaux artworks.
3. Nouveaux artworks = `CardImage` supplémentaires avec un `imageId` propre (choisir un espace qui ne collisionne pas
   avec les id YGOPRODeck) ; fichiers dans `images/big` et `images/small` redimensionnés ; images YGOPRODeck jamais
   modifiées. Mémoriser le fichier Yugipedia source pour ne pas retraiter.
4. Hash en Java : `ImageIO` + dHash 16×16 identique au prototype (`prototype/2-match.mjs`).
5. Point visuel : ce sont des scans réels (holo, légère perspective) à côté des rendus propres de YGOPRODeck.

## Rejouer le prototype

Scripts dans `prototype/` (Node 24, `sharp@0.33.5` installé dans un dossier à part, passé en argument) :

```sh
node prototype/0-fetch-french-pool.mjs <dir>/all.json      # pool FR Yugipedia (titres + passcodes), ~30 requêtes
curl -s "https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes&format=genesys" -o <dir>/ygo.json
node prototype/1-artworks.mjs <dir> <data>                 # échantillon, wikitext, URLs des scans -> <data>/cards.json
T=95 node prototype/2-match.mjs <data> <deps>              # téléchargements + hash -> <data>/report.json
node prototype/3-contact-sheet.mjs <data> <deps> out.png "Nom carte" ...   # planche de contrôle visuel
```
