---
name: unslop-angular
description: Audite le code Angular écrit par une IA (syntaxe d'hier, fuites RxJS, signals mal utilisés, erreurs avalées, tics d'écriture), donne un score reproductible, puis corrige par passes après validation. À utiliser quand l'utilisateur dit /unslop-angular, « unslop », parle de slop, de code Angular généré par IA ou vibecodé à auditer, nettoyer, moderniser ou faire relire, ou demande un score de qualité d'une branche ou d'une codebase Angular.
---

# unslop-angular

Le slop, c'est du **code neuf écrit dans l'Angular d'hier**, ou qui « marche » sans être sain.
Ce skill le trouve, le chiffre, puis le corrige par passes, toujours après validation.

Ressources du skill (`<SKILL_DIR>` = le dossier de ce fichier) :

- `scripts/scan.mjs` : scan déterministe (ESLint embarqué + règles maison). Il produit le score.
- `references/catalogue-regles.md` : les 36 signes (A1 à G5), leur sévérité et leur correction.
- `references/rapport-template.md` : le format du rapport.

## Règles d'or

1. **Auditer avant de corriger.** Aucune modification de code sans validation explicite de l'utilisateur.
2. **Le score vient du scan, et seulement du scan.** Les signes repérés au jugement sont listés à part et n'entrent jamais dans le score : le même code doit toujours donner le même score.
3. **Respecter la version d'Angular du projet.** Ne jamais recommander une API absente de cette version.
4. **Rester dans le périmètre.** Par défaut, seulement les fichiers modifiés de la branche. Le legacy hors périmètre n'est ni signalé comme slop, ni modifié.
5. **Ne rien changer à l'outillage du projet** : pas de modification de sa config ESLint, pas de dépendance ajoutée, pas de commit sans demande.
6. **Rédiger en français**, de façon factuelle : fichier, ligne, signe, correction.

## Étape 1 — Contexte

1. Trouver la racine du workspace (`angular.json`, ou `nx.json` + `package.json` à la racine).
2. Vérifier que `node_modules` est installé dans le projet. Sinon, demander à l'utilisateur de lancer l'installation : le scan a besoin des types d'Angular et de RxJS.
3. Choisir le périmètre :
   - rien de précisé → diff de la branche courante par rapport à la branche principale (défaut du scan) ;
   - « toute la codebase », « tout le projet » → `--all` ;
   - des fichiers ou un dossier cités → les passer en arguments ;
   - une autre branche de base citée → `--base <branche>`.
4. Si l'outil `get_best_practices` du serveur MCP Angular est disponible, l'appeler avec le chemin du workspace : il donne les conventions exactes de la version installée. Sinon, s'appuyer sur le catalogue.

## Étape 2 — Scan déterministe

```bash
# Une seule fois : installer les dépendances du scan (dans le dossier du skill, pas dans le projet)
[ -d <SKILL_DIR>/scripts/node_modules ] || npm install --prefix <SKILL_DIR>/scripts --no-audit --no-fund

# Le scan
node <SKILL_DIR>/scripts/scan.mjs --project <racine> [--base <branche> | --all | <fichiers...>] --out .unslop/scan.json
```

Lire `.unslop/scan.json` :

- `score` (règles basses plafonnées à 10 points chacune), `scoreBrut` (sans plafond), `totals`, `families`, `topFiles`, `byRule` : la synthèse ;
- `findings` : chaque signe avec `id` (catalogue), `sev`, `file`, `line`, `source`, `message` ;
- `scope.list` : les fichiers analysés (base de l'étape 3) ;
- `skipped` : fichiers qu'ESLint n'a pas pu analyser, à mentionner dans le rapport.

Cas particuliers :

- 0 fichier dans le périmètre → le dire et proposer `--all` ;
- code de sortie 2 → lire le message d'erreur (projet non Angular, branche introuvable) et le relayer tel quel.

Le dossier `.unslop/` est créé dans le projet : suggérer de l'ajouter au `.gitignore`, sans le faire.

## Étape 3 — Signes au jugement

Lire les fichiers de `scope.list`. S'il y en a plus de 40, commencer par ceux de `topFiles`, puis les composants.
Chercher uniquement ces signes du catalogue, que le scan ne sait pas détecter :

| ID | Ce qu'il faut repérer |
|---|---|
| B1 | Propriété mutable lue dans le template (`this.loading = true`) : en zoneless (défaut v21+), la vue ne se met pas à jour |
| B5 | Chargement HTTP fait à la main (`subscribe` + flags `loading` / `error`) là où `httpResource` suffirait |
| B6 | `BehaviorSubject` pour un état local de composant |
| D3 | Densité anormale de `?.` et de `!` : symptôme d'un type mal modélisé |
| E2 | Composant qui en recrée un existant. Utiliser `@angularkit/inventory` s'il est installé ; sinon chercher dans la codebase des composants au nom, au sélecteur ou au template proches |
| E4 | Abstraction générique sans besoin (`BaseComponent`, `GenericService<T>`, `utils.ts` fourre-tout) |
| G1 | Commentaire qui paraphrase la ligne suivante, JSDoc sur une méthode triviale |
| G4 | Tests qui ne testent rien (`should create` seul, test du mock) : regarder les `.spec.ts` des fichiers du périmètre |

Pour chaque signe retenu : ID, fichier, ligne, une phrase d'explication, confiance (`forte` ou `moyenne`).
**En cas de doute, ne pas le retenir.** Un faux positif coûte plus cher en crédibilité qu'un oubli.

Relire aussi les signes heuristiques du scan (A4, B2, B3, C3, E3, E5, G3) : quand l'un est clairement un faux positif (ex. : `B2` sur un `Map.set()` dans un `effect`), le classer en « faux positif probable » avec la raison. **Le score ne change pas** : on documente, on ne retouche pas le chiffre.

## Étape 4 — Rapport, puis arrêt

1. Écrire `.unslop/rapport.md` en suivant `references/rapport-template.md`.
2. Résumer dans la conversation : score, totaux par sévérité, les 3 signes Hauts les plus importants, et le plan de passes proposé.
3. **S'arrêter et demander** quelles passes appliquer (toutes, certaines, aucune).

## Étape 5 — Passes de correction

Ordre (chaque passe est validée avant la suivante) :

| Passe | Contenu | IDs |
|---|---|---|
| 0. Filet de tests | Seulement si G4 est retenu (tests qui ne testent rien) ou si le périmètre n'a aucun test | G4 |
| 1. Bugs latents | Tout ce qui est Haut | B1-B3, C1-C3, D2, F1, F2, G2 |
| 2. Migrations mécaniques | Migrations officielles d'Angular | A1, A3, A5, A6, A8, E5 |
| 3. Réactivité | Signals, resources, zoneless | B4-B6, A10, A11 |
| 4. Structure | Découpage, doublons, abstractions, HTTP hors des composants | E1-E4 |
| 5. Typage | `any`, `!`, `?.` | D1, D3 |
| 6. Nettoyage | Tics d'écriture et lignes inutiles | A2, A4, A7, A9, C4, F1 (basses), G1, G3-G5 |

### Passe 0 : poser un filet avant de corriger

Corriger sans tests qui vérifient un comportement, c'est corriger à l'aveugle. Quand la passe 0 s'applique, la proposer en tête du plan :

- écrire 3 à 5 tests de comportement **au niveau de la page ou de la feature** (chargement, action principale, cas d'erreur), en suivant les conventions de test du projet (`CLAUDE.md`, specs existantes) ;
- les faire passer au vert sur le code actuel, **sans le modifier** : ils figent le comportement existant ;
- ne pas supprimer les tests vides existants pendant cette passe (c'est du nettoyage, passe 6).

Si l'utilisateur refuse la passe 0, le noter dans le résumé de chaque passe suivante : « aucun test de comportement ne couvre ces changements ».

### Ordre imposé : signals avant le retrait de zone.js (B1 puis A10)

Quand B1 (état mutable lu dans un template) et A10 (zone.js encore actif) sont présents ensemble, **l'état mutable ne fonctionne que grâce à zone.js**. Retirer zone.js d'abord casse l'affichage sans erreur visible : les valeurs changent, l'écran non.

- Ne jamais retirer `provideZoneChangeDetection`, le polyfill `zone.js` ou la dépendance tant qu'un état mutable lu dans un template subsiste dans l'application (pas seulement dans le périmètre : zone.js est global).
- Si l'utilisateur demande la passe 3 sans la passe 1, traiter B1 au début de la passe 3, avant A10.
- Si B1 ne peut pas être traité partout (hors périmètre, refus), laisser zone.js en place et le dire.
- Le dire dans le plan du rapport : « passer l'état en signals, **puis seulement** retirer zone.js ».

### Migrations officielles d'abord

Pour la passe 2, ne pas réécrire à la main ce qu'une migration d'Angular fait. Lister celles de la version installée :

```bash
node -e 'const c=require("./node_modules/@angular/core/schematics/collection.json");for(const[k,v]of Object.entries(c.schematics))console.log(k,"-",v.description)'
```

Correspondances (noms valables en v22, à vérifier dans la liste ci-dessus) :

| IDs | Migration |
|---|---|
| A1 | `standalone-migration` |
| A3 | `control-flow-migration` |
| A5 | `signal-input-migration`, `signal-queries-migration`, `output-migration` |
| A6 | `inject-migration`, puis `service-migration` (v22+) |
| A8 | `ngclass-to-class-migration`, `ngstyle-to-style-migration`, `common-to-standalone-migration` |
| E5 | `route-lazy-loading-migration` |

Lancer avec `npx ng generate @angular/core:<migration> --path <dossier>` pour rester dans le périmètre.
Si une migration n'accepte pas `--path` (ex. : `cleanup-unused-imports`), prévenir qu'elle touchera toute l'application et demander avant de la lancer.

### Après chaque passe

1. Builder (`npx ng build`, ou la cible Nx équivalente) et lancer les tests s'ils existent et sont rapides.
2. Relancer le scan **avec les mêmes arguments** et donner l'évolution : score avant → après, signes corrigés, signes restants.
3. Résumer les fichiers modifiés et attendre la validation avant la passe suivante.

### Interdits pendant les corrections

- Faire disparaître un signe sans le corriger : `eslint-disable`, `@ts-ignore`, `as any`, test supprimé ou affaibli.
- Changer un comportement visible sans le signaler (ex. : B1, passer une propriété en signal oblige à mettre `()` dans le template).
- Toucher un fichier hors périmètre, sauf s'il faut adapter un appelant : le dire alors explicitement.

## Limites à annoncer honnêtement

- Le scan couvre environ 30 signes automatiques. Certains sont heuristiques (A4, B2, B3, C3) et peuvent se tromper ; les signes au jugement ne sont pas dans le score.
- Ce n'est pas un audit d'architecture, de performance ou de sécurité complet : c'est un diagnostic du code produit avec l'IA.
