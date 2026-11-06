#!/usr/bin/env node
'use strict';
/*
 * tools/docs.js — static integrity audit + living documentation generator.
 *
 *   node tools/docs.js           regenerate headers, docs/MAP.md, docs/SYMBOLS.md
 *   node tools/docs.js --check   verify only; exit 1 on audit errors or stale docs
 *
 * Scripts are analysed in the order of <script src="js/..."> tags in public/index.html.
 */
const fs = require('fs');
const path = require('path');

let acorn;
try {
  acorn = require('acorn');
} catch {
  console.error('Missing dependency "acorn". Run: npm install');
  process.exit(2);
}

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const DOCS_DIR = path.join(ROOT, 'docs');
const CHECK = process.argv.includes('--check');
const MAX_LINES = 400;

const GLOBALS = new Set(`Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError
RangeError SyntaxError Promise Map Set WeakMap WeakSet Proxy Reflect Intl parseInt parseFloat isNaN isFinite
undefined NaN Infinity globalThis encodeURIComponent decodeURIComponent encodeURI decodeURI structuredClone
queueMicrotask setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
window document console navigator location localStorage sessionStorage fetch AbortController AbortSignal URL
URLSearchParams FormData Blob File FileReader Image Event CustomEvent HTMLElement HTMLCanvasElement
HTMLInputElement CanvasRenderingContext2D ImageData Uint8Array Uint8ClampedArray Float32Array ArrayBuffer
atob btoa alert confirm prompt performance DOMParser TextEncoder TextDecoder getComputedStyle crypto
OffscreenCanvas createImageBitmap`.split(/\s+/));

/** Names that exist on window; declaring them at global level is a latent bug. */
const RISKY = new Set(`history name status top parent self event length open close stop print focus blur find
external screen origin closed frames opener scroll`.split(/\s+/));

// ---------------------------------------------------------------- scope analysis

class Scope {
  constructor(parent, isFunc) {
    this.parent = parent;
    this.isFunc = isFunc;
    this.isGlobal = false;
    this.names = new Set();
  }
  has(name) {
    for (let s = this; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  }
}

function childNodes(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type' || key === 'start' || key === 'end') continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x.type === 'string') out.push(x); });
    else if (v && typeof v.type === 'string') out.push(v);
  }
  return out;
}

function patternIds(p, out = []) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p); break;
    case 'ObjectPattern': p.properties.forEach((pr) => patternIds(pr.type === 'RestElement' ? pr.argument : pr.value, out)); break;
    case 'ArrayPattern': p.elements.forEach((e) => patternIds(e, out)); break;
    case 'RestElement': patternIds(p.argument, out); break;
    case 'AssignmentPattern': patternIds(p.left, out); break;
    default: break;
  }
  return out;
}

function declare(ctx, scope, ident, kind) {
  if (!scope.isGlobal) { scope.names.add(ident.name); return; }
  if (ctx.defs.has(ident.name)) ctx.dups.push({ name: ident.name, line: ident.loc.start.line });
  else ctx.defs.set(ident.name, { kind, line: ident.loc.start.line, pos: ident.start });
}

function declareStatements(ctx, stmts, scope) {
  for (const st of stmts) {
    if (st.type === 'FunctionDeclaration') declare(ctx, scope, st.id, 'function');
    else if (st.type === 'ClassDeclaration') declare(ctx, scope, st.id, 'class');
    else if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      for (const d of st.declarations) patternIds(d.id).forEach((id) => declare(ctx, scope, id, st.kind));
    }
  }
}

function hoistVars(ctx, node, scope) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const d of node.declarations) patternIds(d.id).forEach((id) => declare(ctx, scope, id, 'var'));
  }
  if (/^Function/.test(node.type) || node.type === 'ArrowFunctionExpression') return;
  for (const child of childNodes(node)) hoistVars(ctx, child, scope);
}

function ref(ctx, node, scope, inFunc) {
  if (scope.has(node.name)) return;
  ctx.refs.push({ name: node.name, line: node.loc.start.line, pos: node.start, load: !inFunc });
}

function walkPattern(ctx, p, scope, inFunc, isDecl) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': if (!isDecl) ref(ctx, p, scope, inFunc); break;
    case 'ObjectPattern':
      for (const pr of p.properties) {
        if (pr.type === 'RestElement') walkPattern(ctx, pr.argument, scope, inFunc, isDecl);
        else {
          if (pr.computed) walk(ctx, pr.key, scope, inFunc);
          walkPattern(ctx, pr.value, scope, inFunc, isDecl);
        }
      }
      break;
    case 'ArrayPattern': p.elements.forEach((e) => walkPattern(ctx, e, scope, inFunc, isDecl)); break;
    case 'RestElement': walkPattern(ctx, p.argument, scope, inFunc, isDecl); break;
    case 'AssignmentPattern':
      walkPattern(ctx, p.left, scope, inFunc, isDecl);
      walk(ctx, p.right, scope, inFunc);
      break;
    default: walk(ctx, p, scope, inFunc);
  }
}

function walkFunction(ctx, node, scope) {
  const fnScope = new Scope(scope, true);
  if (node.type === 'FunctionExpression' && node.id) fnScope.names.add(node.id.name);
  if (node.type !== 'ArrowFunctionExpression') fnScope.names.add('arguments');
  node.params.forEach((p) => patternIds(p).forEach((id) => fnScope.names.add(id.name)));
  node.params.forEach((p) => walkPattern(ctx, p, fnScope, true, true));
  if (node.body.type === 'BlockStatement') {
    declareStatements(ctx, node.body.body, fnScope);
    hoistVars(ctx, node.body, fnScope);
    node.body.body.forEach((n) => walk(ctx, n, fnScope, true));
  } else {
    walk(ctx, node.body, fnScope, true);
  }
}

function walkClass(ctx, node, scope, inFunc) {
  const s = new Scope(scope, false);
  if (node.id && node.type === 'ClassExpression') s.names.add(node.id.name);
  walk(ctx, node.superClass, scope, inFunc);
  for (const m of node.body.body) {
    if (m.type === 'StaticBlock') {
      const blockScope = new Scope(s, true);
      declareStatements(ctx, m.body, blockScope);
      m.body.forEach((n) => walk(ctx, n, blockScope, inFunc));
      continue;
    }
    if (m.computed) walk(ctx, m.key, s, inFunc);
    if (m.value) walk(ctx, m.value, s, m.type === 'PropertyDefinition' ? true : inFunc);
  }
}

function walk(ctx, node, scope, inFunc) {
  if (!node) return undefined;
  switch (node.type) {
    case 'Identifier': return ref(ctx, node, scope, inFunc);
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': return walkFunction(ctx, node, scope);
    case 'ClassDeclaration':
    case 'ClassExpression': return walkClass(ctx, node, scope, inFunc);
    case 'BlockStatement': {
      const s = new Scope(scope, false);
      declareStatements(ctx, node.body, s);
      node.body.forEach((n) => walk(ctx, n, s, inFunc));
      return undefined;
    }
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement': {
      const s = new Scope(scope, false);
      const init = node.init || node.left;
      if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') {
        init.declarations.forEach((d) => patternIds(d.id).forEach((id) => s.names.add(id.name)));
      }
      childNodes(node).forEach((k) => walk(ctx, k, s, inFunc));
      return undefined;
    }
    case 'CatchClause': {
      const s = new Scope(scope, false);
      if (node.param) patternIds(node.param).forEach((id) => s.names.add(id.name));
      walk(ctx, node.body, s, inFunc);
      return undefined;
    }
    case 'SwitchStatement': {
      walk(ctx, node.discriminant, scope, inFunc);
      const s = new Scope(scope, false);
      declareStatements(ctx, node.cases.flatMap((c) => c.consequent), s);
      node.cases.forEach((c) => {
        walk(ctx, c.test, s, inFunc);
        c.consequent.forEach((n) => walk(ctx, n, s, inFunc));
      });
      return undefined;
    }
    case 'VariableDeclaration':
      for (const d of node.declarations) {
        walkPattern(ctx, d.id, scope, inFunc, true);
        walk(ctx, d.init, scope, inFunc);
      }
      return undefined;
    case 'MemberExpression':
      walk(ctx, node.object, scope, inFunc);
      if (node.computed) walk(ctx, node.property, scope, inFunc);
      return undefined;
    case 'Property':
      if (node.computed) walk(ctx, node.key, scope, inFunc);
      walk(ctx, node.value, scope, inFunc);
      return undefined;
    case 'AssignmentExpression':
      walkPattern(ctx, node.left, scope, inFunc, false);
      walk(ctx, node.right, scope, inFunc);
      return undefined;
    case 'ObjectPattern':
    case 'ArrayPattern':
    case 'AssignmentPattern':
    case 'RestElement': return walkPattern(ctx, node, scope, inFunc, false);
    case 'LabeledStatement': return walk(ctx, node.body, scope, inFunc);
    case 'UnaryExpression':
      if (node.operator === 'typeof' && node.argument.type === 'Identifier') return undefined;
      return walk(ctx, node.argument, scope, inFunc);
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'ThisExpression':
    case 'Literal':
    case 'MetaProperty':
    case 'Super': return undefined;
    default:
      childNodes(node).forEach((k) => walk(ctx, k, scope, inFunc));
      return undefined;
  }
}

function analyze(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });
  const ctx = { defs: new Map(), dups: [], refs: [] };
  const g = new Scope(null, true);
  g.isGlobal = true;
  declareStatements(ctx, ast.body, g);
  hoistVars(ctx, ast, g);
  ast.body.forEach((n) => walk(ctx, n, g, false));
  return ctx;
}

// ---------------------------------------------------------------- project model

function readScriptOrder() {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  return [...html.matchAll(/<script\s+src="js\/([^"]+)"\s*><\/script>/g)].map((m) => m[1]);
}

function lineCount(src) {
  return src.replace(/\n$/, '').split('\n').length;
}

function wrapList(label, names) {
  const tokens = names.length ? names.map((n, i) => (i < names.length - 1 ? n + ',' : n)) : ['(none)'];
  const lines = [];
  let cur = ` * ${label}:`;
  for (const t of tokens) {
    if ((cur + ' ' + t).length > 92) {
      lines.push(cur);
      cur = ' *   ' + t;
    } else cur += ' ' + t;
  }
  lines.push(cur);
  return lines.join('\n') + '\n';
}

const HEADER_RE = /( \* @auto-deps-begin\n)[\s\S]*?( \* @auto-deps-end)/;

function injectHeader(src, defines, uses) {
  return src.replace(HEADER_RE, (m, a, b) => a + wrapList('Defines', defines) + wrapList('Uses', uses) + b);
}

function audit(files) {
  const errors = new Set();
  const warnings = [];
  const owner = new Map();

  files.forEach((f, i) => {
    if (!f.src.startsWith(`/* js/${f.rel} — `)) errors.add(`${f.rel}:1 header must start with "/* js/${f.rel} — <purpose>"`);
    if (!HEADER_RE.test(f.src)) errors.add(`${f.rel}:1 missing @auto-deps-begin / @auto-deps-end markers`);
    if (!/^ \* State: /m.test(f.src)) errors.add(`${f.rel}:1 header lacks a "State:" line`);
    if (!/^ \* Gotchas: /m.test(f.src)) errors.add(`${f.rel}:1 header lacks a "Gotchas:" line`);
    if (lineCount(f.src) > MAX_LINES) warnings.push(`${f.rel} has ${lineCount(f.src)} lines (limit ${MAX_LINES})`);
    f.a.dups.forEach((d) => errors.add(`${f.rel}:${d.line} global "${d.name}" declared twice in the same file`));
    for (const [name, def] of f.a.defs) {
      if (owner.has(name)) {
        const o = owner.get(name);
        errors.add(`${f.rel}:${def.line} global "${name}" is already defined in ${o.rel}:${o.def.line}`);
      } else owner.set(name, { rel: f.rel, index: i, def });
      if (GLOBALS.has(name) || RISKY.has(name)) errors.add(`${f.rel}:${def.line} global "${name}" collides with a browser/builtin global`);
    }
  });

  files.forEach((f, i) => {
    f.uses = new Set();
    f.deps = new Set();
    for (const r of f.a.refs) {
      const o = owner.get(r.name);
      if (o) {
        if (o.rel === f.rel) {
          if (r.load && r.pos < o.def.pos && o.def.kind !== 'function') {
            errors.add(`${f.rel}:${r.line} "${r.name}" is used at load time before its declaration`);
          }
        } else {
          f.uses.add(r.name);
          f.deps.add(o.rel);
          if (r.load && o.index > i) errors.add(`${f.rel}:${r.line} "${r.name}" is used at load time but defined in later script ${o.rel}`);
        }
      } else if (!GLOBALS.has(r.name)) {
        errors.add(`${f.rel}:${r.line} undefined identifier "${r.name}"`);
      }
    }
  });
  return { errors: [...errors], warnings };
}

// ---------------------------------------------------------------- documents

function buildMap(files) {
  const rows = files.map((f, i) => {
    const desc = (f.src.match(/^\/\*\s*\S+\s+—\s+(.*)$/m) || [])[1] || '';
    const deps = [...f.deps].sort().map((d) => `\`${d}\``).join(', ') || '—';
    return `| ${i + 1} | \`${f.rel}\` | ${desc} | ${lineCount(f.src)} | ${f.a.defs.size} | ${deps} |`;
  });
  return [
    '# MAP',
    '',
    '> Generated by `npm run docs`. Do not edit by hand.',
    '',
    'Scripts in load order (same order as `public/index.html`).',
    '',
    '| # | File | Purpose | Lines | Globals | Depends on |',
    '|---|------|---------|-------|---------|------------|',
    ...rows,
    '',
  ].join('\n');
}

function buildSymbols(files) {
  const all = [];
  for (const f of files) for (const [name, d] of f.a.defs) all.push({ name, kind: d.kind, loc: `${f.rel}:${d.line}` });
  all.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name));
  return [
    '# SYMBOLS',
    '',
    '> Generated by `npm run docs`. Do not edit by hand.',
    '',
    '| Symbol | Kind | Location |',
    '|--------|------|----------|',
    ...all.map((s) => `| \`${s.name}\` | ${s.kind} | \`${s.loc}\` |`),
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- main

function main() {
  const order = readScriptOrder();
  if (!order.length) {
    console.error('No <script src="js/..."> tags found in public/index.html');
    process.exit(1);
  }
  let files;
  try {
    files = order.map((rel) => {
      const src = fs.readFileSync(path.join(PUBLIC_DIR, 'js', rel), 'utf8');
      return { rel, src, a: analyze(src) };
    });
  } catch (err) {
    console.error('Parse/read error: ' + err.message);
    process.exit(1);
  }

  const { errors, warnings } = audit(files);
  warnings.forEach((w) => console.warn('warning: ' + w));
  if (errors.length) {
    errors.forEach((e) => console.error('error: ' + e));
    console.error(`\n${errors.length} audit error(s).`);
    process.exit(1);
  }

  // Inject Defines/Uses, then re-analyse so recorded line numbers match the final text.
  const outputs = new Map();
  const finalFiles = files.map((f) => {
    const src = injectHeader(f.src, [...f.a.defs.keys()].sort(), [...f.uses].sort());
    outputs.set(path.join(PUBLIC_DIR, 'js', f.rel), src);
    return { rel: f.rel, src, a: analyze(src), deps: f.deps };
  });
  outputs.set(path.join(DOCS_DIR, 'MAP.md'), buildMap(finalFiles));
  outputs.set(path.join(DOCS_DIR, 'SYMBOLS.md'), buildSymbols(finalFiles));

  const stale = [];
  for (const [file, content] of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === content) continue;
    stale.push(path.relative(ROOT, file));
    if (!CHECK) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }

  if (CHECK && stale.length) {
    console.error('Stale generated content:\n  ' + stale.join('\n  ') + '\nRun: npm run docs');
    process.exit(1);
  }
  console.log(CHECK
    ? `docs check passed (${files.length} scripts, no stale docs).`
    : `docs updated (${stale.length} file(s) changed, ${files.length} scripts audited).`);
}

main();
