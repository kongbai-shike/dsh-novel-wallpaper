/**
 * Smoke test for the DOM/glue half of client.js: runs apply() and the wallpaper
 * draw path against a minimal DOM stub, so a profile restart is not a leap of
 * faith. Also drives the auto-scroll loop to prove it stops at chapter end.
 *
 *   node test/apply.smoke.mjs
 */
import assert from 'node:assert/strict';

/* ───────────────────────── minimal DOM stub ───────────────────────── */

const registry = new Map();

function makeStyle() {
  const props = new Map();
  const style = {
    _props: props,
    setProperty: (k, v) => props.set(k, String(v)),
    removeProperty: (k) => { props.delete(k); },
    getPropertyValue: (k) => (props.has(k) ? props.get(k) : '')
  };
  return style;
}

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    children: [],
    parentNode: null,
    offsetHeight: 0,
    clientHeight: 0,
    style: makeStyle(),
    _attrs: new Map(),
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      if (child.id) registry.set(child.id, child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      if (child.id) registry.delete(child.id);
      return child;
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
      if (el.id) registry.delete(el.id);
    },
    setAttribute(k, v) { el._attrs.set(k, String(v)); },
    getAttribute(k) { return el._attrs.has(k) ? el._attrs.get(k) : null; },
    removeAttribute(k) { el._attrs.delete(k); },
    hasAttribute(k) { return el._attrs.has(k); },
    querySelector: () => null,
    scrollIntoView: () => {}
  };
  return el;
}

const head = makeEl('head');
const body = makeEl('body');

globalThis.document = {
  head,
  body,
  documentElement: makeEl('html'),
  createElement: (tag) => makeEl(tag),
  createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  getElementById: (id) => registry.get(id) || null,
  querySelector: () => null,
  addEventListener: () => {},
  removeEventListener: () => {}
};

function parsePad(padding, which) {
  if (typeof padding !== 'string') return 0;
  const v = padding.trim().split(/\s+/).map((x) => parseFloat(x) || 0);
  if (v.length === 1) return v[0];
  if (v.length === 2) return v[0];
  if (v.length === 3) return which === 2 ? v[2] : v[0];
  return which === 2 ? v[2] : v[0];
}

const surfaceBase = '#101014';
globalThis.getComputedStyle = (el) => ({
  paddingTop: parsePad(el.style.padding, 0) + 'px',
  paddingBottom: parsePad(el.style.padding, 2) + 'px',
  getPropertyValue: (k) => (k === '--dsw-alias-bg-base' ? surfaceBase : el.style.getPropertyValue(k))
});

const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k)
};

let rafCbs = new Map();
let rafId = 1;
globalThis.requestAnimationFrame = (cb) => { const id = rafId++; rafCbs.set(id, cb); return id; };
globalThis.cancelAnimationFrame = (id) => rafCbs.delete(id);
function stepFrame(ts) {
  const pending = [...rafCbs.values()];
  rafCbs.clear();
  pending.forEach((cb) => cb(ts));
}

globalThis.MutationObserver = class { observe() {} disconnect() {} };
const winListeners = new Map();
globalThis.window = {
  __ModuleLoader__: { load: (cfg) => { captured = cfg; } },
  innerWidth: 1400,
  innerHeight: 900,
  addEventListener: (k, fn) => winListeners.set(k, fn),
  removeEventListener: (k) => winListeners.delete(k)
};
let captured = null;

/* ─────────────────────────── load plugin ─────────────────────────── */

const ReactStub = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  Fragment: 'Fragment',
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (f) => f,
  useSyncExternalStore: (_sub, get) => get()
};

await import('../client.js');
const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub;
  throw new Error('unexpected require: ' + name);
});
const { createApp, DEFAULTS, surfaceAlphaPercent } = mod.__internals;

let pass = 0;
const check = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log('  ok   ' + name);
  } catch (err) {
    console.log('  FAIL ' + name + '\n       ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join('\n       ') : err));
    process.exitCode = 1;
  }
};

/* ──────────────────────────── apply() ──────────────────────────── */

const effects = [];
let slotReg = null;
let lastReg = null;
let shortcutReg = null;

const ctx = {
  get: (name) => {
    if (name === 'locale') return { register: () => () => {}, bind: () => (k) => k };
    if (name === 'shortcuts') return { register: (c) => { shortcutReg = c; return () => {}; } };
    return undefined;
  },
  effect: (fn, label) => {
    const dispose = fn();
    effects.push({ label, dispose });
    return dispose;
  },
  slots: {
    inject: (key, cb) => { const dispose = cb(); slotReg = { key, ...(lastReg || {}), dispose }; },
    register: (opts, Comp) => { lastReg = { opts, Comp }; return () => {}; }
  }
};

console.log('apply()');

check('apply() runs without throwing', () => {
  mod.apply(ctx);
});

check('writes a proof-of-load marker', () => {
  const marker = ls.get('dsh-novel-wallpaper:boot');
  assert.ok(marker, 'boot marker must be written so loading is provable on disk');
  assert.ok(!Number.isNaN(Date.parse(marker)), 'marker must be an ISO timestamp');
});

check('registers into shell.overlay', () => {
  assert.equal(slotReg.key, 'shell.overlay');
  assert.equal(slotReg.opts.name, 'shell.overlay');
  assert.equal(slotReg.opts.id, 'novel-wallpaper');
  assert.equal(typeof slotReg.Comp, 'function');
});

check('declares the services it reaches for', () => {
  // Reaching ctx.get('shortcuts') without declaring it left the boss key
  // unregistered: Ctrl+Shift+` did nothing while the eye button worked. The
  // declared service list is the contract that keeps the two equivalent.
  assert.deepEqual(mod.inject, ['slots', 'shortcuts', 'locale']);
});

check('registers the boss key on Ctrl+Shift+`', () => {
  assert.ok(shortcutReg, 'shortcuts.register must be called');
  assert.equal(shortcutReg.id, 'novel-wallpaper.boss');
  const b = shortcutReg.defaults['desktop:windows'];
  assert.equal(b.code, 'Backquote');
  assert.deepEqual(b.modifiers, ['primary', 'shift']);
  assert.equal(shortcutReg.resolve({}).status, 'handled');
  assert.ok(shortcutReg.regions.includes('editable'), 'must still fire while the composer has focus');
  const handled = shortcutReg.resolve({});
  assert.equal(typeof handled.run, 'function');
  // Same entry point the eye button uses; must not throw on its own.
  assert.doesNotThrow(() => handled.run(), 'the hotkey path must run cleanly');
});

check('registers effect cleanups with labels', () => {
  const labels = effects.map((e) => e.label);
  assert.ok(labels.includes('novel-wallpaper: layer'), labels.join(', '));
  assert.ok(labels.includes('novel-wallpaper: theme'));
  assert.ok(labels.includes('novel-wallpaper: boss key'));
  assert.ok(labels.every((l) => typeof l === 'string' && l.length > 0));
});

/* ─────────────────────── wallpaper draw path ─────────────────────── */

console.log('wallpaper layer');

const app = createApp();

check('draw() is a no-op with no book loaded', () => {
  app.draw();
  assert.equal(document.getElementById('dsh-novel-wallpaper-layer'), null, 'no layer before a book exists');
  assert.equal(body.hasAttribute('data-nr-wallpaper'), false);
});

check('draw() builds the behind-the-GUI layer', () => {
  app.runtime.text = '第一章 开端\n正文甲\n正文乙\n第二章 发展\n正文丙';
  app.view.set((v) => ({
    ...v,
    bookId: 'x',
    title: 'T',
    chapter: 0,
    chapters: [
      { title: '第一章 开端', start: 0, end: 15 },
      { title: '第二章 发展', start: 15, end: app.runtime.text.length }
    ]
  }));
  app.draw();

  const layer = document.getElementById('dsh-novel-wallpaper-layer');
  assert.ok(layer, 'layer must be appended to document.body');
  assert.equal(layer.parentNode, body);
  assert.equal(body.hasAttribute('data-nr-wallpaper'), true, 'gate attribute must be set');
  assert.ok(document.getElementById('dsh-novel-wallpaper-style'), 'stylesheet must be injected');
  const inner = layer.children[1].children[0];
  const textOf = (node) => node.children.map((c) => (c.nodeType === 3 ? c.textContent : '')).join('');
  assert.match(textOf(inner), /正文甲/);
  assert.equal(inner.children[0].className, 'nr-title');
  assert.equal(inner.children[0].textContent, '第一章 开端');
});

check('surface clearing is INVERTED so surfaceClear = 1 fully clears', () => {
  // The day-one bug that hid the wallpaper: surfaceClear was fed straight into
  // the colour weight, so the default left the conversation surface OPAQUE.
  assert.equal(body.style.getPropertyValue('--nr-surface-alpha'), '0',
    'surfaceClear = 1 must keep 0% of the original colour (fully clear)');
  const layer = document.getElementById('dsh-novel-wallpaper-layer');
  assert.equal(layer.style.getPropertyValue('--nr-surface-alpha'), '', 'must not be set on the layer');
  assert.equal(body.style.getPropertyValue('--nr-surface-base'), surfaceBase);
});

check('surfaceAlphaPercent maps the knob the right way round', () => {
  assert.equal(surfaceAlphaPercent(1), 0, 'fully cleared');
  assert.equal(surfaceAlphaPercent(0), 100, 'untouched');
  assert.equal(surfaceAlphaPercent(0.25), 75);
  assert.equal(surfaceAlphaPercent(undefined), 0, 'missing value defaults to cleared');
  assert.equal(surfaceAlphaPercent(5), 0, 'clamped above 1');
  assert.equal(surfaceAlphaPercent(-1), 100, 'clamped below 0');
});

check('stealth dims the text instead of deleting it', () => {
  app.persistSettings({ hidden: true, stealthOpacity: 0.1 });
  assert.equal(body.hasAttribute('data-nr-wallpaper'), true, 'stealth keeps the layer alive');
  const layer = document.getElementById('dsh-novel-wallpaper-layer');
  assert.equal(layer.children[1].style.opacity, '0.1');
});

check('stealth opacity 0 hands the GUI back its opaque surfaces', () => {
  app.persistSettings({ stealthOpacity: 0 });
  assert.equal(body.hasAttribute('data-nr-wallpaper'), false);
  app.persistSettings({ hidden: false, stealthOpacity: 0.1 });
  assert.equal(body.hasAttribute('data-nr-wallpaper'), true);
});

/* ───────────────────────── chapter + scroll ───────────────────────── */

console.log('navigation and auto-scroll');

check('gotoChapter jumps and resets the offset', () => {
  app.gotoChapter(1);
  assert.equal(app.view.get().chapter, 1);
  assert.equal(app.runtime.offset, 0);
});

check('auto-scroll advances then stops at the chapter end', () => {
  app.gotoChapter(0);
  app.persistSettings({ speed: 10000 });
  const layer = document.getElementById('dsh-novel-wallpaper-layer');
  const wrap = layer.children[1];
  const inner = wrap.children[0];
  wrap.clientHeight = 800;
  inner.offsetHeight = 900;          // only 100px of scrollable room

  app.play();
  assert.equal(app.view.get().playing, true);
  stepFrame(0);
  stepFrame(1000);                   // 10000 px/s * 1s >> 100px available

  assert.equal(app.runtime.offset, app.runtime.maxOffset, 'must clamp to the end');
  assert.equal(app.view.get().playing, false, 'must pause itself at chapter end');
});

check('pause() stops the loop', () => {
  app.play();
  app.pause();
  assert.equal(app.view.get().playing, false);
});

check('progress is persisted when autoResume is on', () => {
  app.view.set((v) => ({ ...v, bookId: 'x', chapter: 1 }));
  app.persistProgress();
  const raw = JSON.parse(ls.get('dsh-novel-wallpaper:progress'));
  assert.equal(raw.activeId, 'x');
  assert.equal(raw.byId.x.chapter, 1);
});

check('stealth never survives a reload, so the float can always be recovered', () => {
  // Reproduce the stuck state a user hit: a persisted boss-key flag left the
  // float at 12% opacity with its own off-switch hidden.
  ls.set('dsh-novel-wallpaper:settings', JSON.stringify({ hidden: true, opacity: 0.3 }));
  const reloaded = createApp();
  assert.equal(reloaded.settings.get().hidden, false, 'a persisted stealth flag must not hide the float forever');
  assert.equal(reloaded.settings.get().opacity, 0.3, 'other saved settings must still load');
  ls.delete('dsh-novel-wallpaper:settings');
});

/* ───────────────────────── drag targeting ───────────────────────── */

console.log('drag targeting');

const { exceedsDragThreshold, isInteractiveTarget } = mod.__internals;

check('drag threshold: clicks stay clicks, deliberate drags drag', () => {
  assert.equal(exceedsDragThreshold(0, 0, false), false, 'no movement -> click');
  assert.equal(exceedsDragThreshold(3, 3, false), false, 'small jitter must not become a drag');
  assert.equal(exceedsDragThreshold(4, 0, false), true, 'empty area drags at 4px');
  // The regression that made every button dead: a normal press on a control
  // drifted past the empty-area threshold, pointer capture retargeted the
  // click away from the button, and the button never fired.
  assert.equal(exceedsDragThreshold(6, 0, true), false, 'button press with jitter must stay a click');
  assert.equal(exceedsDragThreshold(0, -11, true), false);
  assert.equal(exceedsDragThreshold(12, 0, true), true, 'a deliberate drag from a button still drags');
});

check('recognises presses that land on the float\'s own controls', () => {
  assert.equal(isInteractiveTarget({ closest: () => ({}) }), true, 'inside a control');
  assert.equal(isInteractiveTarget({ closest: () => null }), false, 'empty area');
  assert.equal(isInteractiveTarget(null), false);
  assert.equal(isInteractiveTarget({}), false, 'must not throw when closest() is absent');
});

/* ──────────────────────────── teardown ──────────────────────────── */

console.log('teardown');

check('disposing the layer effect removes every trace', () => {
  const entry = effects.find((e) => e.label === 'novel-wallpaper: layer');
  assert.equal(typeof entry.dispose, 'function');
  entry.dispose();
  assert.equal(document.getElementById('dsh-novel-wallpaper-layer'), null);
  assert.equal(document.getElementById('dsh-novel-wallpaper-style'), null);
  assert.equal(body.hasAttribute('data-nr-wallpaper'), false);
  assert.equal(body.style.getPropertyValue('--nr-surface-alpha'), '');
  assert.equal(body.style.getPropertyValue('--nr-surface-base'), '');
});

console.log('');
console.log(pass + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
