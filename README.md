# unslop-angular

**AI writes yesterday's Angular.** This agent skill finds it, scores it, and fixes it.

`unslop-angular` is a skill for Claude Code (and any agent that reads `SKILL.md` skills). It audits Angular code produced with AI, gives it a reproducible score, and fixes it in passes, each one validated by you before the next.

> Reports and fix summaries are written in **French**.

## Why

Coding agents learned Angular from years of old code. Ask one for a feature in an Angular 21 app and you often get:

- `*ngIf` / `*ngFor` instead of `@if` / `@for`, `@Input()` decorators, constructor injection, `standalone: true` everywhere
- subscriptions that are never closed or cancelled, nested `subscribe` calls
- an `effect()` that writes a signal (a `computed()` in disguise), signals mutated in place
- errors swallowed by `catchError(() => of([]))`
- `setTimeout(() => …)` to "fix" a render cycle
- components duplicated instead of reused, tests that only check `should create`

None of this breaks the build. All of it costs you later.

## How it works

1. **Context**: detects the Angular version and the scope (by default, the files changed on your branch, not your legacy code).
2. **Deterministic scan**: `scripts/scan.mjs` runs a curated, version-aware ESLint setup (angular-eslint, typescript-eslint, rxjs-x) plus custom checks. Same code, same score.
3. **Review**: the agent reads the scoped files for the signs a linter cannot see (duplicated components, empty tests, mutable state that only works thanks to zone.js…). These findings are listed separately and **never change the score**.
4. **Report, then stop**: `.unslop/rapport.md`, then the agent asks which passes to apply.
5. **Fix passes**, each validated before the next: test safety net (when needed), latent bugs, official Angular migrations (`ng generate @angular/core:<migration> --path …`), reactivity, structure, typing, cleanup. Build, tests and a re-scan after each pass.

## Install

As a Claude Code plugin (Claude Code 2.1.275 or later):

```
/plugin install unslop-angular --marketplace GaetanRdn/unslop-angular
```

Or in two steps, on any version with plugin support:

```
/plugin marketplace add GaetanRdn/unslop-angular
/plugin install unslop-angular@unslop-angular
```

Without the plugin system, copy the skill folder into your skills:

```bash
git clone --depth 1 https://github.com/GaetanRdn/unslop-angular /tmp/unslop-angular
cp -r /tmp/unslop-angular/skills/unslop-angular ~/.claude/skills/
```

The skill installs the scanner's dependencies (`scripts/node_modules`, inside the skill folder) on first run. Nothing is added to your project.

Requirements: Node ≥ 20.19, your project's dependencies installed (the scan needs Angular and RxJS types), git for the diff mode.

## Usage

In Claude Code, ask in plain words, or call the skill directly (`/unslop-angular:unslop-angular` as a plugin, `/unslop-angular` as a copied skill):

```
audit the AI-written code on this branch
/unslop-angular:unslop-angular the whole codebase
/unslop-angular:unslop-angular src/app/features/billing
```

The scanner also runs on its own, for CI:

```bash
cd skills/unslop-angular
npm install --prefix scripts
node scripts/scan.mjs --project <angular-workspace> [--base main | --all | <files or folders…>] \
  [--out .unslop/scan.json] [--fail-above <score>]
```

## The score

`score = weighted signs per 1,000 lines` — high 5, medium 2, low 1.

- Each low-severity rule is capped at 10 points, so a mechanical habit repeated everywhere does not hide real bugs. The uncapped score is kept in the JSON (`scoreBrut`).
- Under 2,000 lines, the score is only indicative (`scoreFiable: false`): read the signs, not the number.

Provisional bands, from 8 calibration codebases (Angular 20 to 22):

| Score | Reading |
|---|---|
| < 10 | Clean |
| 10 – 30 | Ordinary debt |
| 30 – 80 | Watch out: slop is settling in |
| > 80 | Massive slop: the AI writes yesterday's Angular |

| Codebase profile | Score |
|---|---|
| Vibe-coded app, no rules | 134 |
| App from an AI app generator | 26 |
| Large human-written app, 5 years old | 21 |
| AI with a `CLAUDE.md` | 10 – 11 |
| AI with strict rules and review agents | 4 – 8 |

## Rules

36 signs in 7 families (yesterday's Angular, reactivity, RxJS and leaks, typing, architecture, templates/a11y/security, AI writing habits), each with a severity and a fix: see [`catalogue-regles.md`](skills/unslop-angular/references/catalogue-regles.md) (French).

- 16 rely on existing ESLint plugins, 13 are custom checks, 7 need the agent's judgment.
- Rules follow the project's Angular version: `standalone: true` is only flagged from v19, explicit `OnPush` only from v22, zone.js only from v21…
- Your project's ESLint config is never used or modified. Targeted `eslint-disable-next-line <rule>` comments are respected and counted as low severity; blanket disables are high severity.

## Limitations

- About 30 automatic checks. A few are heuristics (`track $index`, `effect()` writing a signal, signal mutation, zero-delay `setTimeout`) and can be wrong.
- Calibrated on 8 codebases only. The bands will move.
- This is a diagnosis of AI-produced code, not a full architecture, performance or security audit.

## Credits

Inspired by [unslop](https://github.com/heydamir/unslop) by Damir Sokolovsky, which does the same for AI-looking UI. Built on [angular-eslint](https://github.com/angular-eslint/angular-eslint), [typescript-eslint](https://typescript-eslint.io) and [eslint-plugin-rxjs-x](https://github.com/JasonWeinzierl/eslint-plugin-rxjs-x).

Made by [Gaetan Redin](https://github.com/GaetanRdn) · part of the AngularKit ecosystem.

## License

[MIT](LICENSE)
