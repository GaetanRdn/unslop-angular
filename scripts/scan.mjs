#!/usr/bin/env node
// unslop-angular — scan déterministe.
// Deux couches :
//   1. ESLint avec une config embarquée (angular-eslint, typescript-eslint, rxjs-x),
//      choisie selon la version d'Angular du projet. La config ESLint du projet est ignorée.
//   2. Des règles maison simples, en expressions régulières.
// Chaque signe est rattaché à un ID du catalogue (references/catalogue-regles.md).
//
// Usage :
//   node scan.mjs [--project <dossier>] [--base <branche> | --all] [--out <fichier.json>]
//                 [--fail-above <score>] [fichiers...]

import { ESLint } from 'eslint';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';
import rxjsX from 'eslint-plugin-rxjs-x';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = '0.1.0';
const WEIGHTS = { haute: 5, moyenne: 2, basse: 1 };
// Une même règle basse (tic d'écriture) ne pèse jamais plus que ce plafond dans le score :
// un tic mécanique répété partout ne doit pas masquer les bugs.
const BASSE_CAP = 10;
// En dessous, quelques signes suffisent à faire bouger le score : il reste indicatif.
const MIN_LINES_FOR_RELIABLE_SCORE = 2000;
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.angular', '.git', '.nx', 'coverage', '.unslop']);

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { project: process.cwd(), base: null, all: false, out: null, failAbove: null, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = argv[++i];
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--fail-above') args.failAbove = Number(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('node scan.mjs [--project <dossier>] [--base <branche> | --all] [--out <fichier.json>] [--fail-above <score>] [fichiers...]');
      process.exit(0);
    } else args.files.push(a);
  }
  args.project = path.resolve(args.project);
  return args;
}

// ---------------------------------------------------------------------------
// Contexte du projet
// ---------------------------------------------------------------------------

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function angularMajor(root) {
  const installed = readJson(path.join(root, 'node_modules/@angular/core/package.json'));
  if (installed?.version) return Number(installed.version.split('.')[0]);
  const pkg = readJson(path.join(root, 'package.json'));
  const range = pkg?.dependencies?.['@angular/core'] ?? pkg?.devDependencies?.['@angular/core'];
  const m = range && String(range).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function isGitRepo(root) {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

function resolveBase(root, base) {
  const candidates = base ? [base] : ['origin/main', 'main', 'origin/master', 'master', 'origin/develop', 'develop'];
  for (const c of candidates) {
    try {
      git(root, ['rev-parse', '--verify', '--quiet', c]);
      return c;
    } catch {
      /* suivant */
    }
  }
  return null;
}

function splitLines(s) {
  return s ? s.split('\n').map((l) => l.trim()).filter(Boolean) : [];
}

function walk(dir, root, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, acc);
    else acc.push(path.relative(root, full));
  }
  return acc;
}

function isScannable(rel) {
  const p = rel.split(path.sep).join('/');
  if (p.split('/').some((seg) => IGNORED_DIRS.has(seg))) return false;
  if (/\.(spec|test)\.ts$/.test(p) || p.endsWith('.d.ts')) return false;
  if (/(^|\/)(e2e|cypress|playwright|test-utils|testing|__tests__)\//.test(p)) return false;
  return p.endsWith('.ts') || p.endsWith('.html');
}

function selectFiles(args) {
  const root = args.project;
  if (args.files.length) {
    const files = args.files.flatMap((f) => {
      const abs = path.resolve(root, f);
      return fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? walk(abs, root) : [path.relative(root, abs)];
    });
    return { mode: 'fichiers', base: null, files };
  }
  const repo = isGitRepo(root);
  if (args.all || !repo) {
    const files = repo
      ? [...splitLines(git(root, ['ls-files'])), ...splitLines(git(root, ['ls-files', '--others', '--exclude-standard']))]
      : walk(root, root);
    return { mode: 'all', base: null, files, warning: repo ? null : 'Pas de dépôt git : toute la codebase est analysée.' };
  }
  const base = resolveBase(root, args.base);
  if (!base) {
    throw new Error(`Branche de base introuvable${args.base ? ` (${args.base})` : ''}. Passe --base <branche> ou --all.`);
  }
  const mergeBase = git(root, ['merge-base', 'HEAD', base]);
  const files = [
    ...splitLines(git(root, ['diff', '--name-only', '--diff-filter=ACMR', mergeBase])),
    ...splitLines(git(root, ['ls-files', '--others', '--exclude-standard'])),
  ];
  return { mode: 'diff', base, files };
}

// ---------------------------------------------------------------------------
// Couche 1 : règles ESLint existantes, rattachées au catalogue
// ---------------------------------------------------------------------------

// when(v) : la règle ne s'applique qu'à partir de / jusqu'à une version d'Angular.
const ESLINT_RULES = [
  { rule: '@angular-eslint/template/prefer-control-flow', id: 'A3', sev: 'moyenne', when: (v) => v >= 17 },
  { rule: '@angular-eslint/prefer-signals', id: 'A5', sev: 'moyenne', when: (v) => v >= 19, options: [{ preferReadonlySignalProperties: false }] },
  { rule: '@angular-eslint/prefer-output-emitter-ref', id: 'A5', sev: 'moyenne', when: (v) => v >= 19 },
  { rule: '@angular-eslint/prefer-signal-model', id: 'A5', sev: 'basse', when: (v) => v >= 19 },
  { rule: '@angular-eslint/prefer-inject', id: 'A6', sev: 'basse', when: (v) => v >= 14 },
  { rule: '@angular-eslint/prefer-service-decorator', id: 'A6', sev: 'basse', when: (v) => v >= 22 },
  { rule: '@angular-eslint/prefer-host-metadata-property', id: 'A7', sev: 'basse', when: () => true },
  { rule: '@angular-eslint/template/prefer-class-binding', id: 'A8', sev: 'basse', when: () => true },
  { rule: '@angular-eslint/template/prefer-style-binding', id: 'A8', sev: 'basse', when: () => true },
  { rule: '@angular-eslint/prefer-on-push-component-change-detection', id: 'A9', sev: 'basse', when: (v) => v < 22 },
  { rule: 'rxjs-x/no-ignored-subscription', id: 'C1', sev: 'haute', when: () => true },
  { rule: 'rxjs-x/no-nested-subscribe', id: 'C2', sev: 'haute', when: () => true },
  { rule: 'rxjs-x/no-topromise', id: 'C4', sev: 'moyenne', when: () => true },
  { rule: '@typescript-eslint/no-explicit-any', id: 'D1', sev: 'moyenne', when: () => true },
  { rule: '@angular-eslint/template/no-any', id: 'D1', sev: 'moyenne', when: () => true },
  { rule: '@typescript-eslint/ban-ts-comment', id: 'D2', sev: 'haute', when: () => true },
  { rule: '@typescript-eslint/no-non-null-assertion', id: 'D3', sev: 'basse', when: () => true },
  { rule: '@angular-eslint/template/no-non-null-assertion', id: 'D3', sev: 'basse', when: () => true },
  { rule: 'max-lines', id: 'E1', sev: 'moyenne', when: () => true, options: [{ max: 300, skipBlankLines: true, skipComments: true }] },
  { rule: '@angular-eslint/template/click-events-have-key-events', id: 'F1', sev: 'haute', when: () => true },
  { rule: '@angular-eslint/template/interactive-supports-focus', id: 'F1', sev: 'haute', when: () => true },
  { rule: '@angular-eslint/template/alt-text', id: 'F1', sev: 'haute', when: () => true },
  { rule: '@angular-eslint/template/prefer-ngsrc', id: 'F1', sev: 'basse', when: () => true },
  // main.ts : le CLI génère lui-même un `console.error` dans le bootstrap.
  { rule: 'no-console', id: 'G3', sev: 'basse', when: () => true, skip: (file) => /(^|\/)main\.ts$/.test(file) },
  { rule: '@typescript-eslint/no-unused-vars', id: 'G3', sev: 'basse', when: () => true },
];

const PLUGINS = {
  '@angular-eslint/template': angular.templatePlugin,
  '@angular-eslint': angular.tsPlugin,
  '@typescript-eslint': tseslint.plugin,
  'rxjs-x': rxjsX,
};

function ruleExists(rule) {
  if (!rule.includes('/')) return true; // règle native d'ESLint
  const prefix = rule.startsWith('@angular-eslint/template/') ? '@angular-eslint/template' : rule.slice(0, rule.lastIndexOf('/'));
  const name = rule.slice(prefix.length + 1);
  return Boolean(PLUGINS[prefix]?.rules?.[name]);
}

function buildEslintConfig(root, major) {
  const tsRules = {};
  const htmlRules = {};
  const active = [];
  const missing = [];
  for (const r of ESLINT_RULES) {
    if (!r.when(major)) continue;
    if (!ruleExists(r.rule)) {
      missing.push(r.rule);
      continue;
    }
    const target = r.rule.startsWith('@angular-eslint/template/') ? htmlRules : tsRules;
    target[r.rule] = r.options ? ['warn', ...r.options] : 'warn';
    active.push(r);
  }
  // Les désactivations restent actives : chaque directive est notée à part (D2),
  // plus lourdement quand elle est globale.
  const linterOptions = { reportUnusedDisableDirectives: 'off' };
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { projectService: true, tsconfigRootDir: root },
      },
      plugins: { '@angular-eslint': angular.tsPlugin, '@typescript-eslint': tseslint.plugin, 'rxjs-x': rxjsX },
      processor: angular.processInlineTemplates,
      linterOptions,
      rules: tsRules,
    },
    {
      files: ['**/*.html'],
      languageOptions: { parser: angular.templateParser },
      plugins: { '@angular-eslint/template': angular.templatePlugin },
      linterOptions,
      rules: htmlRules,
    },
  ];
  return { config, active, missing };
}

async function eslintScan(root, files, major) {
  const { config, active, missing } = buildEslintConfig(root, major);
  const byRule = new Map(active.map((r) => [r.rule, r]));
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: config,
    errorOnUnmatchedPattern: false,
    warnIgnored: false,
  });
  const findings = [];
  const skipped = [];
  const absFiles = files.map((f) => path.join(root, f));
  const results = absFiles.length ? await eslint.lintFiles(absFiles) : [];
  for (const res of results) {
    const file = toPosix(path.relative(root, res.filePath));
    for (const m of res.messages) {
      if (m.fatal) {
        skipped.push({ file, reason: m.message.split('\n')[0] });
        continue;
      }
      const r = m.ruleId && byRule.get(m.ruleId);
      if (!r || r.skip?.(file)) continue;
      findings.push({ id: r.id, sev: r.sev, file, line: m.line, source: m.ruleId, message: m.message });
    }
  }
  return { findings, skipped, activeRules: active.length, missingRules: missing };
}

// ---------------------------------------------------------------------------
// Couche 2 : règles maison (expressions régulières)
// ---------------------------------------------------------------------------

const isComponentLike = (text) => /@(Component|Directive)\s*\(/.test(text);
const usesSignals = (text) => /\b(signal|input|model|computed|linkedSignal)\s*[<(]/.test(text);

// scope : 'ts' | 'html' | 'both'. comments : true si la règle doit aussi lire les commentaires.
const REGEX_RULES = [
  { id: 'A1', sev: 'moyenne', scope: 'ts', re: /@NgModule\s*\(/, msg: 'Nouveau NgModule : préférer des composants standalone.' },
  { id: 'A2', sev: 'basse', scope: 'ts', when: (v) => v >= 19, re: /\bstandalone\s*:\s*true\b/, msg: '`standalone: true` est le défaut depuis la v19 : ligne inutile.' },
  { id: 'A8', sev: 'basse', scope: 'ts', file: isComponentLike, re: /^(?!\s*import\b).*\bCommonModule\b/, msg: '`CommonModule` importé en entier : importer seulement les pipes et directives utilisés.' },
  { id: 'A9', sev: 'basse', scope: 'ts', when: (v) => v >= 22, re: /changeDetection\s*:\s*ChangeDetectionStrategy\.OnPush/, msg: '`OnPush` est le défaut depuis la v22 : ligne inutile.' },
  { id: 'A10', sev: 'moyenne', scope: 'ts', when: (v) => v >= 21, re: /provideZoneChangeDetection\s*\(|\.(onStable|onMicrotaskEmpty|onUnstable|isStable)\b/, msg: 'Dépendance à zone.js alors que le zoneless est le défaut depuis la v21.' },
  { id: 'A11', sev: 'moyenne', scope: 'ts', re: /^(?!\s*import\b).*\bUntyped(FormGroup|FormControl|FormArray|FormBuilder)\b/, msg: 'Formulaire non typé : préférer Signal Forms (v22+) ou des reactive forms typés.' },
  { id: 'A11', sev: 'moyenne', scope: 'html', re: /\bngModel\b/, msg: 'Formulaire template-driven (`ngModel`) : préférer Signal Forms (v22+) ou des reactive forms.' },
  { id: 'B3', sev: 'haute', scope: 'ts', file: usesSignals, re: /\b\w+\(\)\s*\.(push|splice|pop|shift|unshift|sort|reverse)\s*\(|\.mutate\s*\(/, msg: 'Mutation en place de la valeur d\'un signal : la vue ne sera pas notifiée. Utiliser `update()` avec une nouvelle référence.' },
  { id: 'E3', sev: 'moyenne', scope: 'ts', file: (t) => /@Component\s*\(/.test(t), re: /inject\(\s*HttpClient\s*\)|\b(private|protected|public|readonly)\s+(readonly\s+)?\w+\s*:\s*HttpClient\b/, msg: '`HttpClient` utilisé directement dans un composant : passer par un service ou `httpResource`.' },
  { id: 'F2', sev: 'haute', scope: 'ts', re: /bypassSecurityTrust(Html|Script|Style|Url|ResourceUrl)\s*\(/, msg: 'Contournement de la sécurité d\'Angular (`bypassSecurityTrust*`).' },
  { id: 'G2', sev: 'haute', scope: 'ts', re: /catchError\s*\(\s*(\([^)]*\)|\w+)\s*=>\s*(of\s*\(\s*(\[\s*\]|\{\s*\}|null|undefined|''|""|false)?\s*\)|EMPTY\b)/, msg: 'Erreur avalée : `catchError` renvoie une valeur vide sans signaler l\'erreur.' },
  { id: 'G3', sev: 'basse', scope: 'ts', re: /\b(class|function|interface)\s+\w+(V2|Old|New)\b/, msg: 'Nom en `V2` / `Old` / `New` : doublon probable d\'une version précédente.' },
];

// Règles multi-lignes, sur tout le texte.
const MULTILINE_RULES = [
  {
    id: 'B2', sev: 'haute', scope: 'ts',
    // Un effect synchrone qui écrit un signal dérive un état. Avec un timer, un abonnement
    // ou de l'asynchrone, c'est un vrai effet de bord : on ne le signale pas.
    find: (text) =>
      findCalls(text, 'effect')
        .filter((c) => /\.(set|update)\s*\(/.test(c.body))
        .filter((c) => !/setTimeout|setInterval|requestAnimationFrame|subscribe\s*\(|\bawait\b|\.then\s*\(|onCleanup/.test(c.body))
        .map((c) => c.index),
    msg: '`effect()` qui écrit dans un signal : préférer `computed()` ou `linkedSignal()`.',
  },
  {
    // `track $index` alors que l'élément a un identifiant (`item.id` utilisé dans la boucle).
    // Sur une liste de primitives, `$index` est le bon choix : non signalé.
    id: 'A4', sev: 'moyenne', scope: 'both',
    find: (text) =>
      [...text.matchAll(/@for\s*\(\s*(\w+)\s+of[^;]*;\s*track\s+\$index\b/g)]
        .filter((m) => new RegExp(`\\b${m[1]}\\.id\\b`).test(text.slice(m.index, m.index + 1500)))
        .map((m) => m.index),
    msg: '`track $index` sur des éléments qui ont un `id` : tracker `item.id`.',
  },
  {
    id: 'C3', sev: 'haute', scope: 'ts',
    find: (text) => findZeroDelayTimeouts(text),
    msg: '`setTimeout` sans délai dans un composant : contournement typique d\'un cycle de rendu. Corriger la cause (`afterNextRender` si besoin réel).',
  },
  {
    id: 'E5', sev: 'moyenne', scope: 'ts',
    find: (text, file) => findEagerRootRoutes(text, file),
    msg: 'Route de feature chargée en dur dans les routes racine : préférer `loadComponent` / `loadChildren`.',
  },
  {
    id: 'D2', sev: 'haute', scope: 'both',
    find: (text) => findDisableDirectives(text).filter((d) => !d.targeted).map((d) => d.index),
    msg: 'Désactivation ESLint globale (sans règle nommée ou sur tout le fichier).',
  },
  {
    id: 'D2', sev: 'basse', scope: 'both',
    find: (text) => findDisableDirectives(text).filter((d) => d.targeted).map((d) => d.index),
    msg: 'Désactivation ESLint ciblée : vérifier qu\'elle est justifiée.',
  },
  {
    id: 'G2', sev: 'haute', scope: 'ts',
    find: (text) => [...text.matchAll(/catch\s*(\(\s*\w*\s*\))?\s*\{\s*console\.(error|log|warn)\([^;{}]*\);?\s*\}/g)].map((m) => m.index),
    msg: 'Erreur avalée : le `catch` ne fait que logger.',
  },
];

// C3 : `setTimeout` sans délai (ou à 0) dans un composant, le contournement typique d'un cycle de rendu.
// Un timer avec un vrai délai (feedback, debounce) n'est pas signalé.
function findZeroDelayTimeouts(text) {
  if (!isComponentLike(text)) return [];
  return findCalls(text, 'setTimeout')
    .filter((c) => {
      const args = topLevelArgs(c.body);
      return args.length < 2 || /^0$/.test(args[1].trim());
    })
    .map((c) => c.index);
}

// Découpe `( a, b, c )` en arguments de premier niveau.
function topLevelArgs(body) {
  const inner = body.slice(1, -1);
  const args = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      args.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) args.push(cur);
  return args;
}

// E5 : route chargée en dur, seulement dans le fichier de routes racine. Les fichiers de routes
// de feature sont déjà chargés en lazy par leur parent ; la route par défaut ('') et le
// joker ('**') peuvent légitimement rester eager.
function findEagerRootRoutes(text, file) {
  if (!/(^|\/)app\.routes\.ts$|(^|\/)app-routing\.module\.ts$/.test(file)) return [];
  const hits = [];
  let lastPath = null;
  for (const m of text.matchAll(/\bpath\s*:\s*(['"`])(.*?)\1|\bcomponent\s*:\s*[A-Z]\w*/g)) {
    if (m[0].startsWith('path')) lastPath = m[2];
    else if (lastPath !== '' && lastPath !== '**') hits.push(m.index);
  }
  return hits;
}

// D2 : directives de désactivation. Globale (sans règle nommée ou sur tout le fichier) = haute ;
// ciblée sur une ligne avec la règle nommée = basse (décision visible, à justifier).
function findDisableDirectives(text) {
  const hits = [];
  for (const m of text.matchAll(/eslint-disable(-next-line|-line)?([ \t]+[@\w/-]+)?/g)) {
    const targeted = Boolean(m[1]) && Boolean(m[2]);
    hits.push({ index: m.index, targeted });
  }
  return hits;
}

// Trouve les appels `name(...)` et renvoie leur corps (parenthèses équilibrées).
function findCalls(text, name) {
  const calls = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) break;
    }
    calls.push({ index: m.index, body: text.slice(start, i + 1) });
  }
  return calls;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--');
}

function regexScan(root, files, major) {
  const findings = [];
  for (const rel of files) {
    const ext = rel.endsWith('.html') ? 'html' : 'ts';
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const file = toPosix(rel);
    const lines = text.split('\n');
    for (const r of REGEX_RULES) {
      if (r.scope !== 'both' && r.scope !== ext) continue;
      if (r.when && !r.when(major)) continue;
      if (r.file && !r.file(text, file)) continue;
      lines.forEach((line, i) => {
        if (!r.comments && isCommentLine(line)) return;
        if (r.re.test(line)) findings.push({ id: r.id, sev: r.sev, file, line: i + 1, source: `unslop/${r.id}`, message: r.msg });
      });
    }
    for (const r of MULTILINE_RULES) {
      if (r.scope !== 'both' && r.scope !== ext) continue;
      for (const index of r.find(text, file)) {
        findings.push({ id: r.id, sev: r.sev, file, line: lineOf(text, index), source: `unslop/${r.id}`, message: r.msg });
      }
    }
  }
  return findings;
}

// Fichiers de config : dépendances superflues (G5) et zone.js dans angular.json (A10).
const HEAVY_DEPS = { moment: 'API native `Intl` / `Date`', jquery: 'API DOM native', underscore: 'API native', lodash: 'API native (vérifier l\'usage réel)', 'lodash-es': 'API native (vérifier l\'usage réel)' };

function configScan(root, scope, major) {
  const findings = [];
  const touched = (f) => scope.mode === 'all' || scope.files.map(toPosix).includes(f);
  if (touched('package.json')) {
    const pkg = readJson(path.join(root, 'package.json'));
    for (const [dep, alt] of Object.entries(HEAVY_DEPS)) {
      if (pkg?.dependencies?.[dep]) {
        findings.push({ id: 'G5', sev: 'moyenne', file: 'package.json', line: 1, source: 'unslop/G5', message: `Dépendance \`${dep}\` : souvent remplaçable par ${alt}.` });
      }
    }
  }
  if (major >= 21 && touched('angular.json')) {
    const raw = fs.existsSync(path.join(root, 'angular.json')) ? fs.readFileSync(path.join(root, 'angular.json'), 'utf8') : '';
    const idx = raw.search(/"zone\.js"/);
    if (idx >= 0) {
      findings.push({ id: 'A10', sev: 'moyenne', file: 'angular.json', line: lineOf(raw, idx), source: 'unslop/A10', message: '`zone.js` encore chargé alors que le zoneless est le défaut depuis la v21.' });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function countLines(root, files) {
  let n = 0;
  for (const f of files) {
    try {
      n += fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter((l) => l.trim()).length;
    } catch {
      /* ignoré */
    }
  }
  return n;
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.id}|${f.file}|${f.line}|${f.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function score(weight, lines) {
  return lines ? Math.round((weight / lines) * 1000 * 10) / 10 : 0;
}

// Poids brut : somme simple. Poids retenu : chaque ID de sévérité basse est plafonné.
function rawWeight(list) {
  return list.reduce((s, f) => s + WEIGHTS[f.sev], 0);
}

function cappedWeight(list) {
  const basseById = new Map();
  let w = 0;
  for (const f of list) {
    if (f.sev === 'basse') basseById.set(f.id, (basseById.get(f.id) ?? 0) + WEIGHTS.basse);
    else w += WEIGHTS[f.sev];
  }
  for (const v of basseById.values()) w += Math.min(v, BASSE_CAP);
  return w;
}

function summarize(findings, lines) {
  const weightOf = cappedWeight;
  const families = {};
  for (const letter of 'ABCDEFG') {
    const list = findings.filter((f) => f.id.startsWith(letter));
    families[letter] = { count: list.length, weight: weightOf(list), score: score(weightOf(list), lines) };
  }
  const files = new Map();
  for (const f of findings) {
    const cur = files.get(f.file) ?? { file: f.file, count: 0, weight: 0 };
    cur.count++;
    cur.weight += WEIGHTS[f.sev];
    files.set(f.file, cur);
  }
  const rules = new Map();
  for (const f of findings) {
    const key = `${f.id}|${f.source}`;
    const cur = rules.get(key) ?? { id: f.id, source: f.source, sev: f.sev, count: 0 };
    cur.count++;
    rules.set(key, cur);
  }
  const capped = [...new Set(findings.filter((f) => f.sev === 'basse').map((f) => f.id))].filter(
    (id) => findings.filter((f) => f.sev === 'basse' && f.id === id).length * WEIGHTS.basse > BASSE_CAP,
  );
  return {
    score: score(weightOf(findings), lines),
    scoreBrut: score(rawWeight(findings), lines),
    plafond: { basseParRegle: BASSE_CAP, reglesPlafonnees: capped },
    totals: {
      haute: findings.filter((f) => f.sev === 'haute').length,
      moyenne: findings.filter((f) => f.sev === 'moyenne').length,
      basse: findings.filter((f) => f.sev === 'basse').length,
    },
    families,
    topFiles: [...files.values()].sort((a, b) => b.weight - a.weight).slice(0, 5),
    byRule: [...rules.values()].sort((a, b) => WEIGHTS[b.sev] * b.count - WEIGHTS[a.sev] * a.count),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.project;
  const major = angularMajor(root);
  if (!major) throw new Error(`Projet Angular introuvable dans ${root} (pas de @angular/core dans package.json).`);

  const scope = selectFiles(args);
  const files = [...new Set(scope.files)].filter(isScannable).filter((f) => fs.existsSync(path.join(root, f)));
  const lines = countLines(root, files);

  const eslintPart = await eslintScan(root, files, major);
  const findings = dedupe([...eslintPart.findings, ...regexScan(root, files, major), ...configScan(root, scope, major)]).sort(
    (a, b) => WEIGHTS[b.sev] - WEIGHTS[a.sev] || a.file.localeCompare(b.file) || a.line - b.line,
  );
  const summary = summarize(findings, lines);

  const report = {
    tool: 'unslop-angular',
    version: VERSION,
    date: new Date().toISOString(),
    project: path.basename(root),
    angular: major,
    scope: { mode: scope.mode, base: scope.base, files: files.length, lines, warning: scope.warning ?? null, list: files.map(toPosix) },
    scoreFiable: lines >= MIN_LINES_FOR_RELIABLE_SCORE,
    weights: WEIGHTS,
    ...summary,
    findings,
    skipped: eslintPart.skipped,
    rules: { eslint: eslintPart.activeRules, maison: REGEX_RULES.length + MULTILINE_RULES.length + 2, absentes: eslintPart.missingRules },
  };

  const json = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(root, args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(root, args.out), json);
  } else {
    process.stdout.write(json + '\n');
  }

  const t = summary.totals;
  console.error(
    `unslop-angular — Angular v${major} — ${scope.mode}${scope.base ? ` (base ${scope.base})` : ''} — ${files.length} fichiers, ${lines} lignes\n` +
      `Score : ${summary.score} pour 1000 lignes — ${t.haute} haute(s), ${t.moyenne} moyenne(s), ${t.basse} basse(s)` +
      (lines < MIN_LINES_FOR_RELIABLE_SCORE ? `\nMoins de ${MIN_LINES_FOR_RELIABLE_SCORE} lignes : score indicatif, regarder plutôt les signes un par un.` : '') +
      (eslintPart.skipped.length ? `\n${eslintPart.skipped.length} fichier(s) non analysé(s) par ESLint (voir "skipped").` : '') +
      (scope.warning ? `\n${scope.warning}` : ''),
  );

  if (args.failAbove != null && summary.score > args.failAbove) process.exit(1);
}

main().catch((err) => {
  console.error(`unslop-angular : ${err.message}`);
  process.exit(2);
});
