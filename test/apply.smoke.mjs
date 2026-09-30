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
// Every command the plugin registers, looked up by id. It registers the boss
// key PLUS the four arrow commands, so a single "last write wins" variable
// silently hid three of them and made this suite pass vacuously on the rest.
const shortcutRegs = [];
const shortcutById = (id) => shortcutRegs.find((c) => c.id === id);

const ctx = {
  get: (name) => {
    if (name === 'locale') return { register: () => () => {}, bind: () => (k) => k };
    if (name === 'shortcuts') return { register: (c) => { shortcutRegs.push(c); return () => {}; } };
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
  const shortcutReg = shortcutById('novel-wallpaper.boss');
  assert.ok(shortcutReg, 'the boss key must be registered');
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

check('registers Ctrl+Shift+arrows for reading', () => {
  const want = [
    ['novel-wallpaper.scroll-up', 'ArrowUp'],
    ['novel-wallpaper.scroll-down', 'ArrowDown'],
    ['novel-wallpaper.prev-chapter', 'ArrowLeft'],
    ['novel-wallpaper.next-chapter', 'ArrowRight']
  ];
  want.forEach(([id, code]) => {
    const reg = shortcutById(id);
    assert.ok(reg, id + ' must be registered');
    const b = reg.defaults['desktop:windows'];
    assert.equal(b.code, code, id + ' must bind ' + code);
    assert.deepEqual(b.modifiers, ['primary', 'shift']);
    // A bare arrow press must never reach the plugin: the service itself
    // rejects an unmodified binding as `modifier-required`.
    assert.ok(b.modifiers.length > 0, id + ' must require a modifier');
    assert.equal(reg.resolve({}).status, 'handled');
    assert.equal(typeof reg.resolve({}).run, 'function');
    // Exercising the entry point must be safe even with no book loaded.
    assert.doesNotThrow(() => reg.resolve({}).run(), id + ' must run cleanly with no book');
  });
});

check('arrow commands never fire inside a text field', () => {
  // Ctrl+Shift+Arrow is "select by word" in every text field. Routing it here
  // would make editing worse — the exact trade the user rejected when choosing
  // "require a modifier".
  ['novel-wallpaper.scroll-up', 'novel-wallpaper.scroll-down', 'novel-wallpaper.prev-chapter', 'novel-wallpaper.next-chapter']
    .forEach((id) => {
      const reg = shortcutById(id);
      assert.ok(!reg.regions.includes('editable'), id + ' must not claim the editable region');
      assert.ok(reg.regions.includes('page'), id + ' must still work over the page');
    });
});

check('only declares the arrow profiles the shortcut service accepts', () => {
  // ArrowUp/Down/Left/Right sit on the service's reserved list. desktop
  // Windows/macOS is the one runtime that bypasses that list, and web+windows
  // admits primary+shift. Declaring desktop:linux or web:macos would have
  // thrown and taken that command's whole registration down with it.
  const reg = shortcutById('novel-wallpaper.scroll-up');
  assert.ok(reg.defaults['desktop:windows']);
  assert.ok(reg.defaults['desktop:macos']);
  assert.ok(reg.defaults['web:windows']);
  assert.equal(reg.defaults['desktop:linux'], undefined, 'ArrowUp is reserved on desktop linux');
  assert.equal(reg.defaults['web:macos'], undefined, 'ArrowUp is reserved on web macos');
});

check('captures the wheel on the window so the default can be cancelled', () => {
  assert.ok(winListeners.has('wheel'), 'a wheel listener must be registered');
  assert.equal(typeof winListeners.get('wheel'), 'function');
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

/* ─────────────────────────── wheel reading ─────────────────────────── */

console.log('wheel reading');

check('one notch moves by speed × wheelStep and clamps at both ends', () => {
  app.gotoChapter(0);
  app.pause();
  app.persistSettings({ speed: 100, wheelStep: 2, hidden: false });
  const layer = document.getElementById('dsh-novel-wallpaper-layer');
  const wrap = layer.children[1];
  const inner = wrap.children[0];
  wrap.clientHeight = 800;
  inner.offsetHeight = 2000;
  app.runtime.offset = 0;
  app.measure();
  const room = app.runtime.maxOffset;
  assert.ok(room > 400, 'the fixture must leave real scrolling room, got ' + room);

  // forward: 100 px/s × 2 = 200px for one notch
  assert.equal(app.wheelScroll(1), true, 'a loaded chapter must consume the gesture');
  stepFrame(0);        // the first frame only establishes the animation origin
  stepFrame(200);      // >= WHEEL_ANIM_MS, so it lands exactly on target
  assert.equal(app.runtime.offset, 200, 'one notch must land on the target, not near it');

  app.wheelScroll(-1);
  stepFrame(1000);
  stepFrame(1300);
  assert.equal(app.runtime.offset, 0);

  app.wheelScroll(-1);
  stepFrame(2000);
  stepFrame(2300);
  assert.equal(app.runtime.offset, 0, 'the top is a wall');

  app.runtime.offset = room - 50;
  app.wheelScroll(1);
  stepFrame(3000);
  stepFrame(3300);
  assert.equal(app.runtime.offset, room, 'so is the end of the chapter');
});

check('a burst of notches accumulates instead of restarting', () => {
  // Retargeting from the stale origin was what made a fast scroll feel like it
  // was fighting back: every notch restarted the glide from where it began and
  // the text never got anywhere.
  app.pause();
  app.persistSettings({ speed: 100, wheelStep: 1, hidden: false });   // 100px per notch
  app.runtime.offset = 0;
  app.applyTransform();
  app.wheelScroll(1);
  stepFrame(0);
  stepFrame(50);          // mid-glide, only part way to the first target
  app.wheelScroll(1);     // must retarget from the PAINTED position
  stepFrame(100);
  stepFrame(300);
  assert.ok(app.runtime.offset > 100, 'the second notch must add to the first, got ' + app.runtime.offset);
});

check('reaching for the wheel ends auto-play', () => {
  app.persistSettings({ speed: 100, wheelStep: 1 });
  app.play();
  assert.equal(app.view.get().playing, true);
  app.wheelScroll(1);
  assert.equal(app.view.get().playing, false, 'a manual gesture means "I am driving now"');
});

check('stealth makes the wheel inert so the boss key really hands the screen back', () => {
  app.pause();
  app.persistSettings({ hidden: true });
  const before = app.runtime.offset;
  assert.equal(app.wheelScroll(1), false, 'must report "not consumed" so the host keeps the gesture');
  assert.equal(app.runtime.offset, before, 'stealth must not move the text');
  app.persistSettings({ hidden: false });
});

check('a chapter that fits leaves the wheel to the host', () => {
  const layer = document.getElementById('dsh-novel-wallpaper-layer');
  const wrap = layer.children[1];
  const inner = wrap.children[0];
  wrap.clientHeight = 800;
  // Well under the available height (800 minus the font-scaled vertical
  // padding), so the chapter genuinely fits and there is nothing to scroll.
  inner.offsetHeight = 600;
  app.measure();
  assert.equal(app.runtime.maxOffset, 0);
  assert.equal(app.wheelScroll(1), false, 'nothing to scroll -> must not swallow the wheel');
  inner.offsetHeight = 2000;
  app.measure();
});

check('auto-play cancels a glide so only one driver owns the offset', () => {
  app.persistSettings({ speed: 100, wheelStep: 2 });
  app.runtime.offset = 0;
  app.wheelScroll(1);
  assert.ok(app.runtime.wheelAnim !== null, 'a glide must be pending');
  app.play();
  assert.equal(app.runtime.wheelAnim, null, 'auto-play must cancel the glide');
  app.pause();
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

const { exceedsDragThreshold, isInteractiveTarget, hostConsumesWheel } = mod.__internals;

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

/* ───────────────────────── wheel arbitration ───────────────────────── */

console.log('wheel arbitration');

// getComputedStyle is how the arbiter asks "can this node still scroll?".
// Swap in a scroller-shaped answer for the duration of one check.
const realGetComputedStyle = globalThis.getComputedStyle;
const withOverflow = (overflowY, fn) => {
  globalThis.getComputedStyle = () => ({ overflowY });
  try { fn(); } finally { globalThis.getComputedStyle = realGetComputedStyle; }
};
const scrollerOf = (over) => Object.assign(
  { nodeType: 1, tagName: 'DIV', scrollTop: 300, clientHeight: 100, scrollHeight: 500, parentElement: null },
  over
);

check('the host keeps the wheel while it can still scroll that way', () => {
  withOverflow('auto', () => {
    const mid = scrollerOf({});
    assert.equal(hostConsumesWheel(mid, 100), true, 'room below -> the host scrolls');
    assert.equal(hostConsumesWheel(mid, -100), true, 'room above -> the host scrolls');

    const atTop = scrollerOf({ scrollTop: 0 });
    assert.equal(hostConsumesWheel(atTop, -100), false, 'nothing above -> the wallpaper takes it');
    assert.equal(hostConsumesWheel(atTop, 100), true, 'still room below -> the host keeps it');

    const atEnd = scrollerOf({ scrollTop: 400 });   // 400 + 100 === scrollHeight
    assert.equal(hostConsumesWheel(atEnd, 100), false, 'nothing below -> the wallpaper takes it');
    assert.equal(hostConsumesWheel(atEnd, -100), true, 'room above -> the host keeps it');
  });
});

check('a node that cannot scroll never claims the wheel', () => {
  withOverflow('visible', () => {
    // No scroll container in the chain at all: the wallpaper gets the gesture.
    assert.equal(hostConsumesWheel(scrollerOf({}), 100), false);
    assert.equal(hostConsumesWheel(scrollerOf({}), -100), false);
  });
  withOverflow('auto', () => {
    // overflow:auto but the content fits, so there is nothing to scroll.
    assert.equal(hostConsumesWheel(scrollerOf({ clientHeight: 500 }), 100), false);
  });
});

check('text fields always keep the wheel', () => {
  withOverflow('visible', () => {
    assert.equal(hostConsumesWheel({ nodeType: 1, tagName: 'TEXTAREA', parentElement: null }, 100), true);
    assert.equal(hostConsumesWheel({ nodeType: 1, tagName: 'INPUT', parentElement: null }, -100), true);
  });
});

check('an exhausted inner scroller hands over to an outer one that has room', () => {
  withOverflow('auto', () => {
    const outer = scrollerOf({});
    const inner = scrollerOf({ scrollTop: 400, parentElement: outer });   // inner exhausted
    assert.equal(hostConsumesWheel(inner, 100), true, 'the outer scroller still has room');
  });
});

check('a directionless wheel event is never ours', () => {
  assert.equal(hostConsumesWheel(scrollerOf({ scrollTop: 0 }), 0), true);
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
