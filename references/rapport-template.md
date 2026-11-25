# Format du rapport `.unslop/rapport.md`

Remplir chaque `{…}` à partir de `.unslop/scan.json` et de l'étape 3. Supprimer une section vide plutôt que d'écrire « aucun ».
Ton : factuel, sans superlatifs, en français. Un lecteur non technique (CTO, manager) doit comprendre la synthèse en 30 secondes.

---

```markdown
# Diagnostic unslop — {project}

{date} · Angular v{angular} · Périmètre : {diff depuis `{base}` | toute la codebase | fichiers choisis} · {files} fichiers, {lines} lignes

## Synthèse

**Score : {score}** pour 1000 lignes (0 = aucun signe ; poids : haute 5, moyenne 2, basse 1)

{Si `scoreFiable` est faux : « Moins de 2 000 lignes analysées : score indicatif, les signes comptent plus que le chiffre. »}

{Si `plafond.reglesPlafonnees` n'est pas vide : « Sans plafond des règles basses : {scoreBrut} (règles plafonnées : {liste}). »}

| Sévérité | Signes |
|---|---|
| Haute — bug latent, faille ou fuite | {totals.haute} |
| Moyenne — dette qui coûte | {totals.moyenne} |
| Basse — tic d'écriture | {totals.basse} |

{2 à 3 phrases : ce qui domine, où ça se concentre, le risque principal. Pas de jugement sur les personnes.}

## Par famille

| Famille | Signes | Score |
|---|---|---|
| A. Angular d'hier | {families.A.count} | {families.A.score} |
| B. Réactivité | … | … |
| C. RxJS et fuites | … | … |
| D. Typage | … | … |
| E. Architecture | … | … |
| F. Templates, accessibilité, sécurité | … | … |
| G. Tics d'IA | … | … |

## Fichiers les plus touchés

| Fichier | Signes | Poids |
|---|---|---|
{topFiles, 5 lignes max}

## Signes de sévérité haute

{Un bloc par signe Haut, du plus grave au moins grave :}

### {ID} — {nom du signe dans le catalogue}
`{file}:{line}` — {message}
**Correction :** {correction du catalogue, adaptée au code}

## Autres signes du scan

| ID | Règle | Sévérité | Nombre |
|---|---|---|---|
{byRule hors sévérité haute}

Détail ligne par ligne : `.unslop/scan.json`.

## Repérés à la lecture (hors score)

| ID | Fichier | Constat | Confiance |
|---|---|---|---|
{signes de l'étape 3}

## Faux positifs probables

| ID | Fichier | Raison |
|---|---|---|
{signes du scan écartés à l'étape 3 ; le score n'est pas modifié}

## Plan de correction proposé

0. **Filet de tests** — {seulement si G4 retenu ou aucun test : les 3 à 5 comportements à couvrir avant toute correction}
1. **Bugs latents** — {nombre} signes : {résumé}
2. **Migrations officielles** — {migrations à lancer}
3. **Réactivité** — … {si B1 et A10 : « passer l'état en signals, **puis seulement** retirer zone.js ; dans l'autre ordre, l'affichage casse »}
4. **Structure** — …
5. **Typage** — …
6. **Nettoyage** — …

{Si `skipped` n'est pas vide : « {n} fichier(s) n'ont pas pu être analysés : {liste}. »}

---
*Diagnostic produit par unslop-angular (@angularkit). Couvre les signes listés dans le catalogue ; ce n'est pas un audit complet d'architecture, de performance ou de sécurité.*
```
