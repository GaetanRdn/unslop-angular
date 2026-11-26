# Catalogue des signes de « slop » dans le code Angular

> Base de travail pour le skill `@angularkit/unslop` (nom provisoire).
> Référence : guide officiel des bonnes pratiques Angular (CLI MCP `get_best_practices`, docs v22).

## Principe

**Le slop, c'est du code neuf écrit dans l'Angular d'hier, ou qui « marche » sans être sain.**
Du code legacy humain écrit en 2019 n'est pas du slop : c'est de la dette. Le skill doit faire la différence.

Trois règles de fonctionnement :

1. **Tenir compte de la version.** Lire la version d'Angular dans `package.json` avant tout. Une règle qui ne s'applique pas à cette version est ignorée (ex. : `OnPush` explicite n'est un tic qu'à partir de la v22).
2. **Commencer par le code récent.** Par défaut, on analyse les fichiers modifiés (diff de la branche, ou derniers commits). L'analyse de toute la codebase reste possible en option.
3. **Auditer avant de corriger.** On produit d'abord un rapport (signe, fichier, ligne, sévérité). Rien n'est modifié sans validation.

## Sévérités

| Sévérité | Sens | Poids (score) |
|---|---|---|
| **Haute** | Bug latent, faille ou fuite : ça cassera en prod | 5 |
| **Moyenne** | Dette qui coûte : maintenance, perf, montée de version | 2 |
| **Basse** | Tic d'écriture : signale l'IA, sans gravité immédiate | 1 |

Détection : **Auto** = repérable par regex ou AST (scan déterministe possible). **Jugement** = l'agent doit lire et trancher.

---

## A. Angular d'hier (syntaxe obsolète)

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| A1 | Nouveau `NgModule` créé pour une feature ou un `SharedModule` | Composants standalone | Auto | Moyenne |
| A2 | `standalone: true` écrit dans le décorateur (défaut depuis v19) | Supprimer la ligne | Auto | Basse |
| A3 | `*ngIf`, `*ngFor`, `*ngSwitch` (dépréciés depuis la v20) | `@if`, `@for`, `@switch` | Auto | Moyenne |
| A4 | `@for` avec `track $index` alors que l'élément a un `id` (sur des primitives, `$index` est correct) | `track item.id` | Auto | Moyenne |
| A5 | `@Input()` / `@Output()` / `@ViewChild()` en décorateurs | `input()`, `output()`, `model()`, `viewChild()` | Auto | Moyenne |
| A6 | Injection par constructeur | `inject()` ; en v22+, `@Service` pour un nouveau service singleton | Auto | Basse |
| A7 | `@HostBinding` / `@HostListener` | Objet `host` du décorateur | Auto | Basse |
| A8 | `ngClass` / `ngStyle`, ou `CommonModule` importé en entier | Bindings `[class.x]` / `[style.x]` ; importer seulement les pipes et directives utilisés | Auto | Basse |
| A9 | `changeDetection: OnPush` explicite en v22+ (c'est le défaut) — **ou**, avant la v22, composant sans `OnPush` | Supprimer / ajouter selon la version | Auto | Basse |
| A10 | `zone.js`, `provideZoneChangeDetection` ou `NgZone.onStable` dans du code neuf en v21+ (zoneless par défaut) | Retirer ; `afterNextRender` à la place de `onStable` | Auto | Moyenne |
| A11 | Formulaire template-driven ou `UntypedFormGroup` dans du code neuf | Signal Forms (v22+) ; sinon reactive forms typés | Auto | Moyenne |

## B. Réactivité (signals)

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| B1 | État de composant en propriétés mutables (`this.loading = true`) lues dans le template | `signal()` — en zoneless, la vue ne se met plus à jour | Jugement | **Haute** |
| B2 | `effect()` synchrone qui fait un `.set()` pour dériver un état (pas de timer, d'abonnement ni d'async) | `computed()` ou `linkedSignal()` | Auto | **Haute** |
| B3 | Mutation en place d'un signal (`items().push(x)`, `.mutate()`) | `update()` qui renvoie une nouvelle référence | Auto | **Haute** |
| B4 | Méthode appelée dans le template pour un calcul (`{{ getTotal() }}`) | `computed()` | Auto | Moyenne |
| B5 | Chargement HTTP fait à la main : `subscribe` + flags `loading` / `error` | `httpResource()` pour la lecture (pas pour les POST/PUT) | Jugement | Moyenne |
| B6 | `BehaviorSubject` pour un état local de composant | `signal()` | Jugement | Moyenne |

## C. RxJS et fuites

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| C1 | `subscribe()` sans désabonnement (ou `destroy$` + `ngOnDestroy` écrits à la main) | `async` pipe, `toSignal()`, `takeUntilDestroyed()` | Auto (heuristique) | **Haute** |
| C2 | `subscribe` imbriqués | `switchMap` / `concatMap` / `mergeMap` selon le besoin | Auto | **Haute** |
| C3 | `setTimeout` **sans délai (ou à 0)** dans un composant, pour « régler » une `ExpressionChangedAfterItHasBeenChecked` ou attendre le rendu. Un vrai délai (feedback, debounce) n'est pas signalé | Corriger la cause ; `afterNextRender` si besoin réel | Auto | **Haute** |
| C4 | `.toPromise()` (déprécié) | `firstValueFrom` / `lastValueFrom`, ou rester en Observable | Auto | Moyenne |

## D. Typage

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| D1 | `any`, `as any` | Vrai type, ou `unknown` + affinage | Auto | Moyenne |
| D2 | `// @ts-ignore`, `eslint-disable` global (sans règle nommée ou sur tout le fichier). Une désactivation ciblée sur une ligne, règle nommée, compte en **basse** | Corriger le problème signalé | Auto | **Haute** |
| D3 | `!` et `?.` en rafale (code défensif partout, faute de modéliser le type) | Modéliser l'absence (types, `@if`, valeurs par défaut) | Auto (densité) | Basse |

## E. Architecture et découpage

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| E1 | Composant fourre-tout (TS > ~300 lignes ou template > ~150, plusieurs responsabilités) | Découper : conteneur + composants de présentation | Auto (seuil) + Jugement | Moyenne |
| E2 | Composant recréé alors qu'un équivalent existe déjà (bouton, modale, carte…) | Réutiliser l'existant — lien avec `@angularkit/inventory` | Jugement | **Haute** |
| E3 | `HttpClient` injecté directement dans un composant | Service dédié ou `httpResource` | Auto | Moyenne |
| E4 | Abstraction générique sans besoin (`BaseComponent`, `GenericService<T>`, `utils.ts` fourre-tout) | Code direct ; factoriser seulement au 3ᵉ usage | Jugement | Moyenne |
| E5 | Route de feature chargée en dur dans les **routes racine** (`component:` au lieu de `loadComponent` / `loadChildren`). Les routes de feature déjà lazy, la route par défaut et `**` ne sont pas signalées | Lazy loading | Auto | Moyenne |

## F. Templates, accessibilité et sécurité

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| F1 | `<div (click)>` ou `<span (click)>` cliquable ; `<img>` sans `alt` | `<button>` ; `alt` pertinent ; `NgOptimizedImage` pour les images statiques | Auto | **Haute** |
| F2 | `[innerHTML]` + `bypassSecurityTrust*` pour faire disparaître une erreur | Sanitizer d'Angular, ou rendu sans HTML brut | Auto | **Haute** |

## G. Tics d'IA (la signature)

| ID | Signe repéré | Correction | Détection | Sév. |
|---|---|---|---|---|
| G1 | Commentaires qui paraphrasent le code (`// Set loading to true`), JSDoc sur chaque méthode triviale | Supprimer ; commenter le *pourquoi*, pas le *quoi* | Auto (heuristique) | Basse |
| G2 | Erreur avalée : `catchError` qui renvoie une valeur vide (`of()`, `of([])`, `of(null)`, `of('')`, `EMPTY`…), `catch (e) { console.error(e) }` sans suite. Un repli sur une vraie valeur ou un événement d'échec n'est pas signalé | Remonter l'erreur ou l'afficher ; état d'erreur explicite | Auto | **Haute** |
| G3 | Code mort, imports inutilisés, `console.log` oubliés, fichiers ou fonctions `*V2` / `*Old` / `*New` | Nettoyer | Auto | Basse |
| G4 | Tests générés qui ne testent rien (`should create` seul, test du mock lui-même) | Tester un comportement visible | Jugement | Moyenne |
| G5 | Dépendance ajoutée pour un besoin trivial (`lodash` pour un `map`, `moment`) | API native | Auto (`package.json`) | Moyenne |

---

## Corrections : ordre des passes

Comme dans unslop, on corrige par passes, chacune validée avant la suivante :

1. **Bugs latents** — toutes les règles Hautes (B1-B3, C1-C3, D2, F1-F2, G2).
2. **Migrations mécaniques** — passer par les migrations officielles d'Angular plutôt que réécrire à la main (`ng generate @angular/core:<migration> --path <dossier>`). En v22 : `standalone-migration`, `control-flow-migration`, `signal-input-migration`, `signal-queries-migration`, `output-migration`, `inject-migration`, `service-migration`, `ngclass-to-class-migration`, `ngstyle-to-style-migration`, `common-to-standalone-migration`, `route-lazy-loading-migration`. La liste exacte se lit dans `node_modules/@angular/core/schematics/collection.json`.
3. **Réactivité** — B4-B6, A10.
4. **Structure** — E1-E5 (dont les doublons détectés via inventory).
5. **Typage** — D1, D3.
6. **Nettoyage** — G1, G3-G5, A2, A6-A9.

## Partie déterministe : ce qui existe déjà, ce qu'on écrit

Décision : le scan déterministe (`scripts/scan.mjs`) tourne **sur ESLint**, avec une config embarquée (on ne touche pas à la config ESLint du projet).
On réutilise les règles existantes. Dans le MVP, les règles « maison » sont des expressions régulières dans `scan.mjs` ; elles passeront dans un plugin ESLint plus tard si l'outil prend.

| ID | Source | Règle |
|---|---|---|
| A1 | Maison | Détecter un nouveau `@NgModule` |
| A2 | Maison | `standalone: true` redondant (selon la version) |
| A3 | angular-eslint | `template/prefer-control-flow` |
| A4 | Maison | `track $index` sur `@for` |
| A5 | angular-eslint | `prefer-signals`, `prefer-output-emitter-ref`, `prefer-signal-model` |
| A6 | angular-eslint | `prefer-inject`, `prefer-service-decorator` (v22+) |
| A7 | angular-eslint | `prefer-host-metadata-property` |
| A8 | angular-eslint + maison | `template/prefer-class-binding`, `template/prefer-style-binding` ; `CommonModule` importé : maison |
| A9 | angular-eslint + maison | `prefer-on-push-component-change-detection` (avant v22) ; `OnPush` redondant en v22+ : maison |
| A10 | Maison | `zone.js`, `provideZoneChangeDetection`, `NgZone.onStable` (v21+) |
| A11 | Maison | Template-driven forms / `UntypedFormGroup` dans du code neuf |
| B1 | Jugement | — |
| B2 | Maison | `.set()` / `.update()` dans un `effect()` |
| B3 | Maison | `.push()` / `.splice()` / `.mutate()` sur la valeur d'un signal |
| B4 | angular-eslint | `template/no-call-expression` (à configurer : lire un signal est aussi un appel) |
| B5, B6 | Jugement | — |
| C1 | rxjs-x | `no-ignored-subscription` |
| C2 | rxjs-x | `no-nested-subscribe` |
| C3 | Maison | `setTimeout` dans un composant |
| C4 | rxjs-x | `no-topromise` |
| D1 | typescript-eslint + angular-eslint | `no-explicit-any`, `template/no-any` |
| D2 | typescript-eslint + maison | `ban-ts-comment` ; `eslint-disable` : maison |
| D3 | typescript-eslint + jugement | `no-non-null-assertion`, `template/no-non-null-assertion` ; densité de `?.` : au jugement dans le MVP |
| E1 | ESLint | `max-lines` (300) ; taille des templates externes : pas encore dans le MVP |
| E2 | `@angularkit/inventory` | — |
| E3 | Maison | `HttpClient` injecté dans un `@Component` |
| E4 | Jugement | — |
| E5 | Maison | `component:` au lieu de `loadComponent` dans les routes |
| F1 | angular-eslint | `template/click-events-have-key-events`, `template/interactive-supports-focus`, `template/alt-text`, `template/prefer-ngsrc` |
| F2 | Maison | `bypassSecurityTrust*` |
| G1 | Jugement (MVP) | Commentaire qui reprend les mots de la ligne suivante |
| G2 | Maison | `catchError(() => of(...))` / `catch` qui ne fait que logger |
| G3 | ESLint + typescript-eslint + maison | `no-console`, `no-unused-vars` ; noms en `V2` / `Old` / `New` : maison |
| G4 | Jugement | — |
| G5 | Maison | Lecture de `package.json` (liste de dépendances superflues) |

**Bilan : 16 règles couvertes (en tout ou partie) par des plugins existants, 13 maison, 7 au jugement (MVP).**

Ce que produit le scan :

- un **JSON** (règle, fichier, ligne, sévérité), lu par le skill ;
- un **rapport Markdown** lisible tel quel ;
- un **code de sortie** pour la CI (seuil de score configurable).

Bonus : le plugin maison (`@angularkit/eslint-plugin-unslop`) peut s'installer seul dans l'ESLint d'une équipe. C'est une deuxième porte d'entrée.

## Score

Décision : **toutes les règles comptent**, Basses comprises, avec un garde-fou.

`score = somme des poids / milliers de lignes analysées`, avec :

- **un plafond de 10 points par règle basse** : un tic mécanique répété partout (ex. : `OnPush` explicite dans un code d'avant la v22) ne doit pas masquer les bugs. Le JSON garde aussi le `scoreBrut`, sans plafond ;

- un sous-score par famille (A à G), pour qu'une avalanche de règles Basses ne masque pas 3 Hautes ;
- le top 5 des fichiers les plus touchés.

Barème à calibrer sur 3-4 vraies codebases avant publication.

Points de calibration (scan v0.2, novembre 2026). Tous en Angular 20 à 22.

| Codebase | Origine | Lignes | Score | Hautes |
|---|---|---|---|---|
| Démo, slop volontaire | Écrit pour le test | 147 | 230 | 15 |
| club-minutes | Vibecodé, sans règles | 864 | 134 | 4 |
| ISP Student Manager | Vibecodé (générateur d'app IA) | 1 643 | 26 | 1 |
| Ghostfolio (`apps/client` + `libs/ui`) | Humain, projet de 5 ans | 51 879 | 21 | 114 |
| angular-exo | IA avec `CLAUDE.md` (formation) | 1 243 | 11 | 2 |
| fx-agentlab | IA avec `CLAUDE.md` | 297 | 10 | 0 |
| EasyAngularKit | IA très cadrée (règles + agents) | 12 910 | 7,6 | 8 |
| KettleBoost | IA très cadrée (règles + agents) | 11 786 | 3,9 | 1 |

Bandes provisoires (à revoir avec plus de points) :

| Score | Lecture |
|---|---|
| < 10 | Propre |
| 10 – 30 | Dette ordinaire, à traiter au fil de l'eau |
| 30 – 80 | À surveiller : le slop s'installe |
| > 80 | Slop massif : l'IA écrit l'Angular d'hier |

Sous 2 000 lignes, le score est indicatif (`scoreFiable: false`).

## Top 10 pour la vidéo

Les signes les plus parlants à l'écran, parce qu'immédiatement reconnaissables :

1. A2 — `standalone: true` partout (le « tell » le plus visible)
2. A3 — `*ngIf` dans un projet en v21
3. C3 — le `setTimeout` magique
4. B2 — l'`effect()` qui fait un `set()`
5. C1 — le `subscribe` qui fuit
6. G2 — `catchError(() => of([]))` : l'erreur qui disparaît
7. D2 — le `@ts-ignore` pour faire passer
8. E2 — le 4ᵉ composant bouton
9. G1 — le commentaire qui répète la ligne du dessous
10. B3 — le `push` dans un signal (la vue ne bouge pas)

## Questions ouvertes

- Seuils de E1 et de D3 : à fixer sur des cas réels.
- Le linting typé (nécessaire aux règles RxJS) est lent sur une grosse codebase : vérifier que le scan limité au diff suffit.
- Sur toute une codebase legacy, A6 (`inject()`) peut remonter des centaines de cas : faut-il plafonner le poids d'une même règle ?

Tranché : scan déterministe dès la v0 (sur ESLint) ; toutes les règles comptent dans le score.
