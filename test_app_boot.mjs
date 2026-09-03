// Boots index.html's inline script under a minimal DOM shim and asserts the
// app initialises: deck lists populated, unit dropdowns filled.
//
// Exists because a temporal-dead-zone ReferenceError once shipped to
// production: the script aborted on load and every deck list sat at
// "Loading...". Nothing in the suite executed the app, so nothing caught it.
//
//   node test_app_boot.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync('./index.html', 'utf8');
const script = html.match(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/)[1];

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail++; };

class El {
  constructor(tag, attrs) {
    attrs = attrs || {};
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.style = {}; this.dataset = attrs.dataset || {};
    this._cls = new Set(String(attrs.className || '').split(/\s+/).filter(Boolean));
    this.id = attrs.id || ''; this.type = attrs.type || ''; this.name = attrs.name || '';
    this.value = attrs.value || ''; this.checked = !!attrs.checked; this.disabled = false;
    this.textContent = ''; this._html = ''; this.parent = null;
    if (this.tagName === 'SELECT') this.options = this.children;
  }
  get classList() {
    const s = this._cls;
    return { add: (...c) => c.forEach(x => s.add(x)),
             remove: (...c) => c.forEach(x => s.delete(x)),
             contains: (c) => s.has(c),
             toggle: (c, f) => (f === undefined ? (s.has(c) ? s.delete(c) : s.add(c)) : (f ? s.add(c) : s.delete(c))) };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(' ').filter(Boolean)); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children.length = 0; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener() {} removeEventListener() {} scrollIntoView() {} focus() {} click() {}
  setAttribute(k, v) { if (k === 'id') this.id = v; this['attr_' + k] = v; }
  getAttribute(k) { return this['attr_' + k]; }
  closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parent; } return null; }
  querySelector(sel) { return query(descendants(this), sel)[0] || null; }
  querySelectorAll(sel) { return query(descendants(this), sel); }
}
const descendants = (el) => el.children.flatMap(c => [c, ...descendants(c)]);

// Supports exactly the selector shapes index.html uses.
function matches(el, sel) {
  const parts = String(sel).trim().match(/^([a-z]+)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)(:checked)?$/i);
  if (!parts) return false;
  const tag = parts[1], cls = parts[2] || '', attrs = parts[3] || '', checked = parts[4];
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const c of cls.match(/[.#][\w-]+/g) || []) {
    if (c[0] === '.' && !el._cls.has(c.slice(1))) return false;
    if (c[0] === '#' && el.id !== c.slice(1)) return false;
  }
  for (const a of attrs.match(/\[[^\]]+\]/g) || []) {
    const m = a.slice(1, -1).match(/^([\w-]+)\s*=\s*"?([^"\]]*)"?$/);
    if (!m) return false;
    const key = m[1], want = m[2];
    const got = key.startsWith('data-')
      ? el.dataset[key.slice(5).replace(/-(\w)/g, (x, c) => c.toUpperCase())]
      : el[key];
    if (String(got) !== want) return false;
  }
  if (checked && !el.checked) return false;
  return true;
}
function query(pool, sel) {
  const out = [];
  for (const part of String(sel).split(',')) {
    const chunks = part.trim().split(/\s+/);
    if (chunks.length === 1) {
      for (const e of pool) if (matches(e, chunks[0])) out.push(e);
    } else {
      for (const rootEl of pool.filter(e => matches(e, chunks[0])))
        for (const d of descendants(rootEl)) if (matches(d, chunks[1])) out.push(d);
    }
  }
  return [...new Set(out)];
}

const root = new El('body');
const byId = new Map();
function make(tag, attrs) {
  const e = new El(tag, attrs); root.appendChild(e);
  if (e.id) byId.set(e.id, e);
  return e;
}

// Build stubs from the real markup so ids, radios and tabs match the app.
for (const m of html.matchAll(/id="([\w-]+)"/g)) if (!byId.has(m[1])) make('div', { id: m[1] });
for (const m of html.matchAll(/<input[^>]*type="(?:radio|checkbox)"[^>]*>/g)) {
  const tag = m[0];
  const g = (k) => { const r = tag.match(new RegExp(k + '="([^"]*)"')); return r ? r[1] : ''; };
  const el = make('input', { type: g('type'), name: g('name'), value: g('value'),
                             id: g('id'), checked: /\schecked/.test(tag) });
  if (el.id) byId.set(el.id, el);
}
for (const m of html.matchAll(/<button[^>]*class="tab-btn[^"]*"[^>]*data-tab="(\w+)"[^>]*>/g))
  make('button', { className: 'tab-btn' + (m[1] === 'vocab' ? ' active' : ''), dataset: { tab: m[1] } });
for (const m of html.matchAll(/class="tab-panel[^"]*"\s+data-panel="(\w+)"/g))
  make('div', { className: 'tab-panel', dataset: { panel: m[1] } });
// The bundled-deck payload the app parses on load.
const bStart = html.indexOf('>', html.indexOf('id="bundled-tsvs"')) + 1;
const bEnd = html.indexOf('</' + 'script>', bStart);
const bundleJson = html.slice(bStart, bEnd);
(byId.get('bundled-tsvs') || make('script', { id: 'bundled-tsvs' })).textContent = bundleJson;

const hint = byId.get('hint') || make('div', { id: 'hint' });
for (const cls of ['hint-desktop', 'hint-mobile']) {
  const sp = new El('span', { className: cls }); sp.parent = hint; hint.children.push(sp);
}

const document = {
  getElementById: (id) => byId.get(id) || make('div', { id }),
  querySelector: (s) => query(descendants(root), s)[0] || null,
  querySelectorAll: (s) => query(descendants(root), s),
  createElement: (t) => new El(t),
  addEventListener() {}, body: root, documentElement: new El('html'),
};
const store = new Map();
const ctx = {
  document, console,
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  navigator: { language: 'en-US' },
  location: { protocol: 'file:' },          // skips service-worker registration
  speechSynthesis: { getVoices: () => [], speak() {}, cancel() {}, addEventListener() {} },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  fetch: () => Promise.reject(new Error('no network in test')),
  Audio: function () { return { play: () => Promise.resolve(), pause() {} }; },
};
ctx.window = Object.assign({ addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) }, ctx);
ctx.globalThis = ctx;

console.log('=== boot index.html ===');
try {
  vm.createContext(ctx);
  new vm.Script(script, { filename: 'index.html' }).runInContext(ctx);
  ok(true, 'inline script evaluated without throwing');
} catch (e) {
  ok(false, 'script threw on load -> ' + e.constructor.name + ': ' + e.message);
  console.log('\nThe app would sit on "Loading..." forever.');
  console.log(String(e.stack).split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

console.log('\n=== deck library populated ===');
const lists = [['libVocab', 'vocabulary'], ['libGrammar', 'grammar'], ['libConj', 'conjugation']];
for (const pair of lists) {
  const el = byId.get(pair[0]);
  const n = el ? el.children.length : 0;
  ok(n > 0, pair[1] + ' tab lists ' + n + ' deck(s)');
  ok(!(el && /Loading/.test(el.innerHTML)), pair[1] + ' tab is not stuck on "Loading..."');
}
const sels = [['unitVocab', 'vocabulary'], ['unitGrammar', 'grammar'], ['unitConj', 'conjugation']];
for (const pair of sels) {
  const el = byId.get(pair[0]);
  const n = el ? el.children.length : 0;
  ok(n > 1, pair[1] + ' unit dropdown has ' + n + ' options');
}

console.log(fail ? '\n' + fail + ' app-boot check(s) FAILED.' : '\nAll app-boot checks passed.');
process.exit(fail ? 1 : 0);
