/**
 * dsh-novel-wallpaper — client half.
 *
 * Renders a TXT novel as a full-frame text layer BEHIND the DSH Desktop GUI,
 * plus a stealth draggable controller float inside `shell.overlay`.
 *
 * Layering recipe (same proven approach the installed wallpaper-engine uses):
 *   - the text layer is appended to `document.body` as a fixed, click-through
 *     element at z-index -2, with a scrim at z-index -1;
 *   - a body attribute gates a stylesheet that clears the opaque theme token
 *     feeding the conversation surface, so the text shows through.
 * On Windows the shell material is `off`, so transparency is pure CSS.
 *
 * Privacy: everything lives in this browser tab (IndexedDB + localStorage).
 * Nothing is sent to the host, appended to the session log, or exposed to the
 * model — the host row in cordis.patch.yml has an empty `apply`.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-novel-wallpaper',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React;

    /* ───────────────────────────── constants ───────────────────────────── */

    const ACTIVE_ATTR = 'data-nr-wallpaper';
    const LAYER_ID = 'dsh-novel-wallpaper-layer';
    const STYLE_ID = 'dsh-novel-wallpaper-style';
    const LS_SETTINGS = 'dsh-novel-wallpaper:settings';
    const LS_LIBRARY = 'dsh-novel-wallpaper:library';
    const LS_PROGRESS = 'dsh-novel-wallpaper:progress';
    const LS_POS = 'dsh-novel-wallpaper:pos';
    const DB_NAME = 'dsh-novel-wallpaper';
    const DB_STORE = 'novels';

    // Leading whitespace must be HORIZONTAL only: `\s` includes `\n`, which
    // would let a match start on the blank line before the heading and make the
    // chapter boundary (and its extracted title) land on the wrong line.
    const DEFAULT_CHAPTER_RE = '^[ \\t\\u3000]*(第[0-9一二三四五六七八九十百千零〇两]+[章节回卷篇]|Chapter\\s+\\d+)';

    const DEFAULTS = {
      opacity: 0.18,          // wallpaper text opacity
      stealthOpacity: 0.1,    // opacity while the boss key is engaged
      fontSize: 34,
      fontFamily: '',
      lineHeight: 1.9,
      letterSpacing: 0.02,
      color: '',              // '' = follow the host theme token
      scrimColor: '#000000',
      scrimAlpha: 0.35,
      speed: 38,              // px / second
      wheelStep: 6,           // one notch / arrow press = speed × this many px
      surfaceClear: 1,        // 1 = conversation surface fully cleared
      showChapterTitle: true,
      autoResume: true,
      chapterRe: DEFAULT_CHAPTER_RE,
      hidden: false
    };

    const DICT = {
      zh: {
        toc: '目录', prev: '上一章', next: '下一章', play: '自动播放', pause: '暂停',
        settings: '设置', library: '书库', hide: '隐身', show: '现身',
        open: '导入 TXT', loading: '正在解析…', empty: '还没有小说，点右上角 ＋ 导入一个 TXT 文件',
        drop: '松开即导入', chapter: '章节', of: '/', read: '共', chapters: '章',
        jump: '跳到这里', del: '删除', back: '返回', close: '关闭',
        preface: '前言', full: '全文',
        s_opacity: '文字不透明度', s_stealth: '隐身档不透明度', s_size: '字号',
        s_color: '字体颜色', s_font: '字体', s_line: '行距', s_spacing: '字间距',
        s_scrimColor: '阅读器背景色', s_scrimAlpha: '背景浓度', s_speed: '滚动速度',
        s_wheel: '滚轮灵敏度',
        s_surface: '界面清底程度', s_title: '显示章节标题', s_resume: '记住阅读进度',
        s_re: '分章正则', s_reset: '恢复默认', auto: '跟随主题',
        faintWarn: '文字不透明度只有 {p}%，壁纸几乎看不见',
        faintFix: '一键恢复可见',
        presetReadable: '看得清', presetBalanced: '平衡', presetStealth: '极隐蔽',
        presetHint: '预设',
        noLoadWarn: '书库里有 {n} 本书，但没有一本载入成功 —— 所以壁纸不会显示',
        retryLoad: '重试载入',
        hint: '把 TXT 拖到窗口任意位置即可导入',
        bossHint: 'Ctrl+Shift+` 隐身',
        dragHint: '按住任意位置拖动'
      },
      en: {
        toc: 'Contents', prev: 'Prev', next: 'Next', play: 'Auto-scroll', pause: 'Pause',
        settings: 'Settings', library: 'Library', hide: 'Hide', show: 'Show',
        open: 'Import TXT', loading: 'Parsing…', empty: 'No novel yet — click ＋ to import a TXT file',
        drop: 'Drop to import', chapter: 'Chapter', of: '/', read: 'of', chapters: 'chapters',
        jump: 'Jump here', del: 'Delete', back: 'Back', close: 'Close',
        preface: 'Preface', full: 'Full text',
        s_opacity: 'Text opacity', s_stealth: 'Stealth opacity', s_size: 'Font size',
        s_color: 'Text color', s_font: 'Font', s_line: 'Line height', s_spacing: 'Letter spacing',
        s_scrimColor: 'Reader background', s_scrimAlpha: 'Background strength', s_speed: 'Scroll speed',
        s_wheel: 'Wheel sensitivity',
        s_surface: 'Surface clearing', s_title: 'Show chapter title', s_resume: 'Remember progress',
        s_re: 'Chapter regex', s_reset: 'Reset defaults', auto: 'Follow theme',
        faintWarn: 'Text opacity is only {p}% — the wallpaper is effectively invisible',
        faintFix: 'Make it visible',
        presetReadable: 'Readable', presetBalanced: 'Balanced', presetStealth: 'Barely there',
        presetHint: 'Presets',
        noLoadWarn: 'The library holds {n} books but none loaded — so no wallpaper is shown',
        retryLoad: 'Retry loading',
        hint: 'Drop a TXT anywhere to import',
        bossHint: 'Ctrl+Shift+` to hide',
        dragHint: 'Drag from anywhere'
      }
    };

    let t = (k) => (DICT.zh[k] !== undefined ? DICT.zh[k] : k);

    /* ─────────────────────────── tiny store ─────────────────────────── */

    function createStore(initial) {
      let state = initial;
      const subs = new Set();
      return {
        get: () => state,
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : patch;
          if (next === state) return;
          state = next;
          subs.forEach((fn) => fn());
        },
        subscribe(fn) {
          subs.add(fn);
          return () => subs.delete(fn);
        }
      };
    }

    function useStore(store) {
      return useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /* ───────────────────────── persistence ───────────────────────── */

    function readJson(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const v = JSON.parse(raw);
        return v === null || v === undefined ? fallback : v;
      } catch {
        return fallback;
      }
    }

    function writeJson(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota / private mode: keep running in memory */
      }
    }

    function loadSettings() {
      const merged = { ...DEFAULTS, ...readJson(LS_SETTINGS, {}) };
      // Stealth must never survive a reload. The only way out of stealth used to
      // be the float itself — which stealth renders at 12% opacity — so a
      // persisted boss-key state could hide the float permanently with no
      // discoverable way back. A reload is now always a guaranteed escape hatch;
      // the hotkey still works within the session.
      merged.hidden = false;
      return merged;
    }

    /* ────────────────────────── IndexedDB ────────────────────────── */

    function openDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('indexedDB unavailable'));
          return;
        }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE, { keyPath: 'id' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function idbRun(mode, fn) {
      const db = await openDb();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, mode);
          let out;
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
          out = fn(tx.objectStore(DB_STORE), (v) => { out = v; });
        });
      } finally {
        db.close();
      }
    }

    const idbPut = (rec) => idbRun('readwrite', (os) => { os.put(rec); });
    const idbDel = (id) => idbRun('readwrite', (os) => { os.delete(id); });
    const idbGet = (id) => idbRun('readonly', (os, set) => {
      const r = os.get(id);
      r.onsuccess = () => set(r.result || null);
    });

    /* ───────────────────── TXT decoding & chapters ───────────────────── */

    function decodeTxt(buffer) {
      const bytes = new Uint8Array(buffer);
      const has = (a, b, c) => bytes.length > 2 && bytes[0] === a && bytes[1] === b && bytes[2] === c;
      if (has(0xef, 0xbb, 0xbf)) {
        return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8 (BOM)' };
      }
      if (bytes.length > 1 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
      }
      if (bytes.length > 1 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
      }
      try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
      } catch {
        /* not valid UTF-8 — the common case for Chinese TXT */
      }
      try {
        return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' };
      } catch {
        return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8 (lossy)' };
      }
    }

    function splitChapters(text, patternSource) {
      let re;
      try {
        re = new RegExp(patternSource || DEFAULT_CHAPTER_RE, 'gm');
      } catch {
        re = new RegExp(DEFAULT_CHAPTER_RE, 'gm');
      }
      const marks = [];
      let m;
      let guard = 0;
      while ((m = re.exec(text)) !== null) {
        // The pattern only anchors the chapter token, so take the WHOLE line as
        // the title: "第一章 开端" is a useful TOC entry, "第一章" alone is not.
        // Resolve the line around the match rather than from m.index, so a
        // leading newline can never produce an empty title.
        const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
        let lineEnd = text.indexOf('\n', m.index);
        if (lineEnd === -1) lineEnd = text.length;
        const line = text.slice(lineStart, lineEnd);
        marks.push({ index: lineStart, title: line.replace(/\s+/g, ' ').trim().slice(0, 80) });
        if (m.index === re.lastIndex) re.lastIndex += 1;
        if (++guard > 200000) break;
      }
      if (marks.length === 0) {
        return [{ title: t('full'), start: 0, end: text.length }];
      }
      const chapters = [];
      if (marks[0].index > 0) {
        chapters.push({ title: t('preface'), start: 0, end: marks[0].index, preface: true });
      }
      for (let i = 0; i < marks.length; i += 1) {
        const start = marks[i].index;
        const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
        chapters.push({ title: marks[i].title || `${t('chapter')} ${i + 1}`, start, end });
      }
      return chapters;
    }

    function makeId() {
      return 'nw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    async function importFile(file, settings, onStatus) {
      onStatus(t('loading'));
      const buffer = await file.arrayBuffer();
      const { text, encoding } = decodeTxt(buffer);
      const normalized = text.replace(/\r\n?/g, '\n');
      const chapters = splitChapters(normalized, settings.chapterRe);
      const rec = {
        id: makeId(),
        title: (file.name || 'novel.txt').replace(/\.txt$/i, ''),
        encoding,
        size: file.size,
        addedAt: Date.now(),
        text: normalized,
        chapters
      };
      await idbPut(rec);
      return rec;
    }

    /* ─────────────────────── wallpaper layer ─────────────────────── */

    const LAYER_CSS = `
#${LAYER_ID} {
  position: fixed; inset: 0; z-index: -2; overflow: hidden;
  pointer-events: none; contain: layout paint style;
}
#${LAYER_ID} .nr-scrim { position: absolute; inset: 0; z-index: 0; }
#${LAYER_ID} .nr-wrap {
  position: absolute; inset: 0; z-index: 1; overflow: hidden;
  display: flex; justify-content: center; align-items: flex-start;
}
#${LAYER_ID} .nr-inner {
  will-change: transform;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: break-word;
  text-align: justify;
  text-justify: inter-ideograph;
  font-weight: 400;
  max-width: min(74ch, 88vw);
  transform: translate3d(0, 0, 0);
}
#${LAYER_ID} .nr-title {
  display: block; margin-bottom: 0.9em; opacity: 0.85;
  text-align: center; font-weight: 600; letter-spacing: 0.06em;
}
/* Clear the opaque token that feeds the conversation surface so the text layer
   behind shows through. --nr-surface-alpha is how much of the ORIGINAL colour is
   KEPT, so 0 means fully clear (surfaceClear = 1). The original value is
   snapshotted into --nr-surface-base so partial clearing stays theme-correct. */
body[${ACTIVE_ATTR}="on"] {
  --dsw-alias-bg-base: color-mix(in srgb,
      var(--nr-surface-base, #101014) calc(var(--nr-surface-alpha, 0) * 1%),
      transparent) !important;
}
body[${ACTIVE_ATTR}="on"] .dshDesktopFrame { background: transparent !important; }
body[${ACTIVE_ATTR}="on"] .dshDesktopConversationSurface { background: transparent !important; }
`;

    function ensureStyle() {
      let tag = document.getElementById(STYLE_ID);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = STYLE_ID;
        tag.textContent = LAYER_CSS;
        (document.head || document.documentElement).appendChild(tag);
      }
      return tag;
    }

    function ensureLayer() {
      let el = document.getElementById(LAYER_ID);
      if (el) return el;
      el = document.createElement('div');
      el.id = LAYER_ID;
      el.setAttribute('aria-hidden', 'true');
      const scrim = document.createElement('div');
      scrim.className = 'nr-scrim';
      const wrap = document.createElement('div');
      wrap.className = 'nr-wrap';
      const inner = document.createElement('div');
      inner.className = 'nr-inner';
      wrap.appendChild(inner);
      el.appendChild(scrim);
      el.appendChild(wrap);
      document.body.appendChild(el);
      el.__nr = { scrim, wrap, inner };
      return el;
    }

    /* Snapshot the theme's own --dsw-alias-bg-base while our rule is not
       matching, so the color-mix above has a stable base to fade from. */
    function snapshotSurfaceBase() {
      const body = document.body;
      if (!body) return;
      const had = body.hasAttribute(ACTIVE_ATTR);
      if (had) body.removeAttribute(ACTIVE_ATTR);
      const value = getComputedStyle(body).getPropertyValue('--dsw-alias-bg-base').trim();
      if (had) body.setAttribute(ACTIVE_ATTR, 'on');
      if (value) body.style.setProperty('--nr-surface-base', value);
    }

    /* ──────────────────────── the app object ──────────────────────── */

    function createApp() {
      const settings = createStore(loadSettings());
      const view = createStore({
        bookId: null,
        title: '',
        chapter: 0,
        chapters: [],
        playing: false,
        panel: null,        // null | 'toc' | 'settings' | 'library'
        books: readJson(LS_LIBRARY, []),
        status: '',
        pos: readJson(LS_POS, null),
        dragOver: false,
        progress: readJson(LS_PROGRESS, { activeId: null, byId: {} })
      });

      const runtime = {
        text: '',
        offset: 0,
        maxOffset: 0,
        raf: null,
        playing: false,
        // -1, not 0: a real rAF timestamp can legitimately be 0, and 0 is falsy,
        // which would make the next frame compute dt = 0 and stall the scroll.
        last: -1,
        layer: null,
        // Kept separate from `raf`: the auto-scroll loop and a wheel glide must
        // be cancellable independently, or one would silently kill the other.
        wheelAnim: null
      };

      // Self-reporting diagnostics. A failed IndexedDB read used to be swallowed
      // by `.catch(() => {})`, which made "26 books on disk, none loaded" look
      // like nothing was wrong. Every branch of the load path now records what
      // happened, and the whole trail is persisted where it can be read from
      // outside the browser.
      const diagSteps = [];
      function note(step, extra) {
        try {
          diagSteps.push({ t: Date.now(), step, ...(extra || {}) });
          if (diagSteps.length > 60) diagSteps.shift();
          const s = settings.get();
          writeJson('dsh-novel-wallpaper:diag', {
            at: new Date().toISOString(),
            books: (view.get().books || []).length,
            bookId: view.get().bookId,
            chapters: (view.get().chapters || []).length,
            textLen: runtime.text ? runtime.text.length : 0,
            layerActive: typeof document !== 'undefined' && document.body
              ? document.body.hasAttribute(ACTIVE_ATTR)
              : null,
            effectiveOpacity: s.hidden ? s.stealthOpacity : s.opacity,
            hidden: !!s.hidden,
            status: view.get().status,
            steps: diagSteps
          });
        } catch {
          /* diagnostics must never break the plugin */
        }
      }

      const persistSettings = (patch) => {
        settings.set((s) => ({ ...s, ...patch }));
        // `hidden` is deliberately session-scoped and not written to disk.
        const { hidden, ...rest } = settings.get();
        writeJson(LS_SETTINGS, rest);
        draw();
      };

      const persistProgress = () => {
        const v = view.get();
        if (!settings.get().autoResume || !v.bookId) return;
        const byId = { ...v.progress.byId, [v.bookId]: { chapter: v.chapter, offset: Math.round(runtime.offset) } };
        const next = { activeId: v.bookId, byId };
        view.set((s) => ({ ...s, progress: next }));
        writeJson(LS_PROGRESS, next);
      };

      /* ---- wallpaper drawing ---- */

      function currentChapterText() {
        const v = view.get();
        const ch = v.chapters[v.chapter];
        if (!ch || !runtime.text) return { title: '', body: '' };
        const raw = runtime.text.slice(ch.start, ch.end);
        const lines = raw.split('\n');
        const first = (lines[0] || '').trim();
        const body = ch.title && first === ch.title ? lines.slice(1).join('\n') : raw;
        return { title: ch.title || '', body: body.replace(/^\n+/, '') };
      }

      function draw() {
        const s = settings.get();
        const stealth = !!s.hidden;
        const effOpacity = stealth ? s.stealthOpacity : s.opacity;

        // Nothing loaded, or the stealth level is fully transparent: hand the
        // GUI back its normal opaque surfaces and get out of the way.
        if (!runtime.text || effOpacity <= 0.001) {
          document.body.removeAttribute(ACTIVE_ATTR);
          if (runtime.layer) runtime.layer.style.display = 'none';
          note('draw-skipped', {
            hasText: !!runtime.text,
            textLen: runtime.text ? runtime.text.length : 0,
            effOpacity
          });
          return;
        }
        const layer = (runtime.layer = ensureLayer());
        layer.style.display = '';
        ensureStyle();

        document.body.style.setProperty('--nr-surface-alpha', String(surfaceAlphaPercent(s.surfaceClear)));
        document.body.setAttribute(ACTIVE_ATTR, 'on');
        note('draw-active', { textLen: runtime.text.length, effOpacity });

        const { scrim, inner } = layer.__nr;

        // scrim
        scrim.style.background = hexToRgba(s.scrimColor, s.scrimAlpha);

        // typography
        inner.style.fontSize = s.fontSize + 'px';
        inner.style.lineHeight = String(s.lineHeight);
        inner.style.letterSpacing = s.letterSpacing + 'em';
        inner.style.fontFamily = s.fontFamily || 'inherit';
        inner.style.color = s.color || 'var(--dsw-alias-label-primary, #e6e6e6)';

        layer.__nr.wrap.style.opacity = String(effOpacity);

        // padding scales with font size so the text never hugs the edges
        const padY = Math.round(s.fontSize * 1.6);
        const padX = Math.round(s.fontSize * 1.6);
        layer.__nr.wrap.style.padding = `${padY}px ${padX}px`;

        const { title, body } = currentChapterText();
        inner.textContent = '';
        if (s.showChapterTitle && title) {
          const tEl = document.createElement('span');
          tEl.className = 'nr-title';
          tEl.textContent = title;
          inner.appendChild(tEl);
        }
        inner.appendChild(document.createTextNode(body));

        measure();
        applyTransform();
        snapshotSurfaceBase();
      }

      function measure() {
        const layer = runtime.layer;
        if (!layer) return;
        const { wrap, inner } = layer.__nr;
        const cs = getComputedStyle(wrap);
        const padTop = parseFloat(cs.paddingTop) || 0;
        const padBottom = parseFloat(cs.paddingBottom) || 0;
        const avail = wrap.clientHeight - padTop - padBottom;
        runtime.maxOffset = Math.max(0, inner.offsetHeight - avail);
        runtime.offset = Math.min(runtime.offset, runtime.maxOffset);
      }

      function applyTransform() {
        const layer = runtime.layer;
        if (!layer) return;
        layer.__nr.inner.style.transform = `translate3d(0, ${-Math.round(runtime.offset)}px, 0)`;
      }

      /* ---- wheel / arrow reading ---- */

      function cancelWheelAnim() {
        if (runtime.wheelAnim !== null) {
          cancelAnimationFrame(runtime.wheelAnim);
          runtime.wheelAnim = null;
        }
      }

      // Glide the reading offset to `to`. Progress is measured from frame DELTAS
      // rather than an absolute clock origin: a rAF timestamp is only comparable
      // to other rAF timestamps, and mixing in performance.now() would make the
      // first frame's elapsed time absurd (or negative).
      //
      // A gesture that lands mid-glide retargets from the CURRENT painted
      // position, so a held arrow key or a fast notch sequence accumulates into
      // one continuous motion instead of restarting from a stale origin.
      function animateOffsetTo(to) {
        measure();
        const from = runtime.offset;
        const target = Math.max(0, Math.min(to, runtime.maxOffset));
        if (Math.abs(target - from) < 0.5) {
          runtime.offset = target;
          applyTransform();
          return;
        }
        cancelWheelAnim();
        let elapsed = 0;
        let prev = null;
        const stepAnim = (ts) => {
          if (prev === null) prev = ts;
          elapsed += Math.max(0, ts - prev);
          prev = ts;
          const p = elapsed >= WHEEL_ANIM_MS ? 1 : elapsed / WHEEL_ANIM_MS;
          const eased = 1 - Math.pow(1 - p, 3);   // ease-out cubic
          runtime.offset = from + (target - from) * eased;
          applyTransform();
          if (p < 1) {
            runtime.wheelAnim = requestAnimationFrame(stepAnim);
          } else {
            runtime.wheelAnim = null;
            runtime.offset = target;
            applyTransform();
            persistProgress();
          }
        };
        runtime.wheelAnim = requestAnimationFrame(stepAnim);
      }

      // One wheel notch or one arrow press. `dir` > 0 reads forward (the text
      // slides up), `dir` < 0 reads back. Returns true when the gesture was
      // consumed, so the caller knows whether to swallow the DOM event.
      //
      // Stealth is deliberately inert: the boss key exists to hand the screen
      // back completely, so the reading controls go dead with it.
      //
      // A manual gesture also ends auto-play: reaching for the wheel or an arrow
      // means "I'm driving now", and leaving the loop running would fight it.
      function wheelScroll(dir) {
        const s = settings.get();
        if (s.hidden) return false;
        if (!runtime.text) return false;
        measure();
        // Nothing to scroll (chapter shorter than the frame, or not measured
        // yet): not consumed, so the host keeps the gesture.
        if (!runtime.maxOffset) return false;
        if (view.get().playing) pause();
        const stepPx = Math.max(1, s.speed * s.wheelStep);
        animateOffsetTo(runtime.offset + (dir > 0 ? stepPx : -stepPx));
        return true;
      }

      /* ---- auto-scroll engine ---- */

      function tick(ts) {
        const s = settings.get();
        const v = view.get();
        if (!runtime.playing) {
          runtime.raf = null;
          return;
        }
        const dt = runtime.last >= 0 ? Math.min(0.1, (ts - runtime.last) / 1000) : 0;
        runtime.last = ts;
        runtime.offset += s.speed * dt;
        if (runtime.offset >= runtime.maxOffset) {
          runtime.offset = runtime.maxOffset;
          applyTransform();
          runtime.playing = false;
          runtime.raf = null;
          runtime.last = -1;
          view.set((st) => ({ ...st, playing: false }));
          persistProgress();
          return;   // stop at the end of the chapter, as specified
        }
        applyTransform();
        runtime.raf = requestAnimationFrame(tick);
      }

      function play() {
        if (!runtime.text) return;
        cancelWheelAnim();   // the loop and a wheel glide must never both drive offset
        measure();
        if (runtime.offset >= runtime.maxOffset) runtime.offset = 0;
        runtime.playing = true;
        runtime.last = -1;
        view.set((v) => ({ ...v, playing: true }));
        if (!runtime.raf) runtime.raf = requestAnimationFrame(tick);
      }

      function pause() {
        runtime.playing = false;
        runtime.last = -1;
        if (runtime.raf) cancelAnimationFrame(runtime.raf);
        runtime.raf = null;
        view.set((v) => ({ ...v, playing: false }));
        persistProgress();
      }

      const togglePlay = () => (view.get().playing ? pause() : play());

      /* ---- chapter navigation ---- */

      function gotoChapter(index, keepOffset) {
        const v = view.get();
        if (!v.chapters.length) return;
        cancelWheelAnim();   // a glide targeting the OLD chapter must not survive
        const i = Math.max(0, Math.min(v.chapters.length - 1, index));
        if (!keepOffset) runtime.offset = 0;
        view.set((s) => ({ ...s, chapter: i }));
        draw();
        persistProgress();
      }

      /* ---- book loading ---- */

      async function loadBook(id, restore) {
        note('load-start', { id, restore: !!restore });
        let rec = null;
        try {
          // A hanging IndexedDB read resolves neither branch, so nothing is ever
          // reported and the plugin just looks dead. Bound it and turn a hang
          // into the same visible failure as a throw.
          rec = await Promise.race([
            idbGet(id),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('IndexedDB 读取超时（15s）')), 15000);
            })
          ]);
        } catch (err) {
          const msg = String((err && err.message) || err);
          note('load-threw', { id, message: msg });
          view.set((v) => ({ ...v, status: '载入失败（IndexedDB 读取异常）: ' + msg }));
          return;
        }
        if (!rec) {
          note('load-null-record', { id });
          view.set((v) => ({ ...v, status: '载入失败：IndexedDB 里没有这条记录 (' + id + ')' }));
          return;
        }
        runtime.text = rec.text || '';
        runtime.offset = 0;
        const progress = view.get().progress;
        let chapter = 0;
        if (restore && settings.get().autoResume && progress.byId && progress.byId[id]) {
          chapter = progress.byId[id].chapter || 0;
        }
        const chapters = Array.isArray(rec.chapters) ? rec.chapters : [];
        view.set((v) => ({
          ...v,
          bookId: id,
          title: rec.title,
          chapters,
          chapter: Math.max(0, Math.min(chapters.length - 1, chapter)),
          status: ''
        }));
        note('load-ok', {
          id,
          chapters: chapters.length,
          textLen: runtime.text.length,
          chaptersIsArray: Array.isArray(rec.chapters)
        });
        draw();
        if (restore && settings.get().autoResume && progress.byId && progress.byId[id]) {
          runtime.offset = progress.byId[id].offset || 0;
          measure();
          applyTransform();
        }
      }

      async function importFiles(fileList) {
        const files = Array.from(fileList || []).filter((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
        if (!files.length) {
          view.set((v) => ({ ...v, status: '仅支持 .txt 文件' }));
          return;
        }
        for (const file of files) {
          try {
            const rec = await importFile(file, settings.get(), (s) => view.set((v) => ({ ...v, status: s })));
            const light = {
              id: rec.id, title: rec.title, size: rec.size, encoding: rec.encoding,
              chapterCount: rec.chapters.length, addedAt: rec.addedAt
            };
            view.set((v) => {
              const books = [light, ...v.books.filter((b) => b.id !== light.id)];
              writeJson(LS_LIBRARY, books);
              return { ...v, books, status: '' };
            });
            await loadBook(rec.id, false);
          } catch (err) {
            view.set((v) => ({ ...v, status: '导入失败: ' + (err && err.message ? err.message : err) }));
          }
        }
      }

      async function removeBook(id) {
        await idbDel(id);
        view.set((v) => {
          const books = v.books.filter((b) => b.id !== id);
          writeJson(LS_LIBRARY, books);
          const next = { ...v, books };
          if (v.bookId === id) {
            next.bookId = null;
            next.title = '';
            next.chapters = [];
            next.chapter = 0;
          }
          return next;
        });
        if (!view.get().bookId && view.get().books.length) {
          await loadBook(view.get().books[0].id, true);
        } else {
          draw();
        }
      }

      /* ---- boss key ---- */

      function toggleStealth() {
        const s = settings.get();
        const hidden = !s.hidden;
        settings.set((st) => ({ ...st, hidden }));
        const { hidden: _omit, ...rest } = settings.get();
        writeJson(LS_SETTINGS, rest);   // session-scoped, never persisted
        if (hidden) pause();
        draw();
      }

      /* ---- position ---- */

      function movePos(x, y) {
        view.set((v) => ({ ...v, pos: { x, y } }));
        writeJson(LS_POS, { x, y });
      }

      return {
        settings, view, runtime, persistSettings, draw, measure, applyTransform,
        play, pause, togglePlay, gotoChapter, loadBook, importFiles, removeBook,
        toggleStealth, movePos, persistProgress, note, wheelScroll, cancelWheelAnim,
        refreshSurface: () => { snapshotSurfaceBase(); draw(); }
      };
    }

    function hexToRgba(hex, alpha) {
      let c = String(hex || '#000000').replace('#', '').trim();
      if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
      const n = parseInt(c || '000000', 16);
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    /* ───────────────────────────── icons ───────────────────────────── */

    const S = (props) => h('svg', {
      width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
      strokeLinejoin: 'round', 'aria-hidden': true, ...props
    });

    const Icons = {
      toc: () => h(S, null, h('path', { d: 'M4 6h16M4 12h16M4 18h10' })),
      prev: () => h(S, null, h('path', { d: 'M15 5l-7 7 7 7' })),
      next: () => h(S, null, h('path', { d: 'M9 5l7 7-7 7' })),
      play: () => h(S, null, h('path', { d: 'M7 4l12 8-12 8z', fill: 'currentColor', stroke: 'none' })),
      pause: () => h(S, null, h('path', { d: 'M8 4v16M16 4v16' })),
      gear: () => h(S, null,
        h('circle', { cx: 12, cy: 12, r: 3.2 }),
        h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1' })),
      plus: () => h(S, null, h('path', { d: 'M12 5v14M5 12h14' })),
      eye: () => h(S, null,
        h('path', { d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' }),
        h('circle', { cx: 12, cy: 12, r: 2.6 })),
      eyeOff: () => h(S, null,
        h('path', { d: 'M2 12s3.6-6.5 10-6.5c2 0 3.7.6 5.1 1.5M22 12s-3.6 6.5-10 6.5c-2 0-3.7-.6-5.1-1.5' }),
        h('path', { d: 'M4 20L20 4' })),
      book: () => h(S, null,
        h('path', { d: 'M4 5.5A2.5 2.5 0 016.5 3H19v18H6.5A2.5 2.5 0 014 18.5z' }),
        h('path', { d: 'M8 3v18' })),
      trash: () => h(S, null, h('path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14' })),
      back: () => h(S, null, h('path', { d: 'M19 12H5M11 18l-6-6 6-6' }))
    };

    /* ─────────────────────────── UI atoms ─────────────────────────── */

    const token = (name) => `var(${name})`;

    // Free dragging, whale-widget style: a press anywhere starts a *potential*
    // drag, which only becomes real once the pointer travels past a threshold.
    //
    // The threshold is LARGER when the press lands on one of the float's own
    // controls. Reason: pointer capture retargets the follow-up mouse events —
    // including `click` — to the capturing element, so hijacking an ordinary
    // button press silently swallows the click and the button looks dead. A
    // 4px threshold did exactly that on 30px buttons: near-every click drifted
    // past it and the rail stopped responding.
    const DRAG_THRESHOLD = 4;            // empty area: drag almost immediately
    const DRAG_THRESHOLD_CONTROL = 12;   // pressing a control: only a real drag

    // One wheel notch / arrow press glides to its target over this long. Short
    // enough to feel immediate, long enough that a fast notch sequence reads as
    // one continuous motion instead of teleporting.
    const WHEEL_ANIM_MS = 180;
    function exceedsDragThreshold(dx, dy, fromControl) {
      const limit = fromControl ? DRAG_THRESHOLD_CONTROL : DRAG_THRESHOLD;
      return Math.abs(dx) >= limit || Math.abs(dy) >= limit;
    }

    function isInteractiveTarget(el) {
      try {
        return !!(el && el.closest && el.closest(
          'button, input, select, textarea, a, [role="button"], [contenteditable="true"]'
        ));
      } catch {
        return false;
      }
    }

    // Which side owns one wheel gesture.
    //
    // The novel is painted BEHIND the entire GUI, so a naive global wheel
    // handler would steal the gesture from the chat transcript, from every
    // settings panel, and from our own contents list — all of which live above
    // the wallpaper and expect to scroll normally.
    //
    // So the host keeps the gesture whenever the hovered node can still scroll
    // that way. Only when nothing above us wants it does the wallpaper take it.
    // That makes "scroll the chat to its end, then keep going" hand the wheel
    // over naturally, without a mode switch.
    function hostConsumesWheel(target, deltaY) {
      if (!deltaY) return true;   // no direction: nothing for us to do
      const down = deltaY > 0;
      let el = target;
      while (el && el.nodeType === 1) {
        const tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable === true) return true;
        let cs = null;
        try { cs = getComputedStyle(el); } catch { cs = null; }
        const overflowY = cs && cs.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
          && el.scrollHeight > el.clientHeight + 1) {
          const room = down
            ? el.scrollTop + el.clientHeight < el.scrollHeight - 1
            : el.scrollTop > 1;
          if (room) return true;
        }
        el = el.parentElement;
      }
      return false;
    }

    // How much of the ORIGINAL surface colour to keep: surfaceClear = 1 means
    // fully cleared, so the kept fraction is its inverse. Inverting this is what
    // hid the wallpaper behind an opaque surface at the default setting.
    function surfaceAlphaPercent(surfaceClear) {
      const n = Number(surfaceClear);
      const clamped = Math.max(0, Math.min(1, Number.isFinite(n) ? n : 1));
      return Math.round((1 - clamped) * 100);
    }

    const iconBtnStyle = {
      width: 30, height: 30, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', border: 'none', borderRadius: token('--dsw-radius-sm'),
      background: 'transparent', color: token('--dsw-alias-label-secondary'),
      cursor: 'pointer', padding: 0, flex: '0 0 auto'
    };

    function IconButton({ label, onClick, active, disabled, children }) {
      const [hover, setHover] = useState(false);
      return h('button', {
        type: 'button', title: label, 'aria-label': label, disabled: !!disabled,
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); if (!disabled) onClick(); },
        onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false),
        style: {
          ...iconBtnStyle,
          background: hover && !disabled ? token('--dsw-alias-interactive-bg-hover') : 'transparent',
          color: active ? token('--dsw-static-deepseek-450') : token('--dsw-alias-label-secondary'),
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'default' : 'pointer'
        }
      }, children);
    }

    const panelStyle = {
      position: 'absolute',
      width: 'min(340px, calc(100vw - 32px))',
      maxHeight: '62vh',
      display: 'flex', flexDirection: 'column',
      background: token('--dsw-alias-bg-overlay'),
      color: token('--dsw-alias-label-primary'),
      border: `1px solid ${token('--dsw-alias-border-l3')}`,
      borderRadius: token('--dsw-radius-lg'),
      boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
      overflow: 'hidden',
      fontSize: 13,
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)'
    };

    const panelHeadStyle = {
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 8px 8px 14px',
      borderBottom: `1px solid ${token('--dsw-alias-border-l2')}`,
      color: token('--dsw-alias-label-secondary'), flex: '0 0 auto'
    };

    const rowStyle = {
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 14px'
    };

    function Row({ label, children }) {
      return h('div', { style: rowStyle },
        h('span', { style: { flex: '1 1 auto', color: token('--dsw-alias-label-secondary') } }, label),
        h('span', { style: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 8 } }, children));
    }

    function Slider({ value, min, max, step, onChange }) {
      return h('input', {
        type: 'range', min, max, step, value,
        onChange: (e) => onChange(Number(e.target.value)),
        style: { width: 140, accentColor: token('--dsw-static-deepseek-450'), cursor: 'pointer' }
      });
    }

    /* ─────────────────────── controller float ─────────────────────── */

    function Controller({ app }) {
      const view = useStore(app.view);
      const settings = useStore(app.settings);
      const ref = useRef(null);
      const drag = useRef(null);
      const [hover, setHover] = useState(false);
      const [size, setSize] = useState({ w: 1280, h: 800 });

      useEffect(() => {
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        onResize();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);

      const hasBook = (view.chapters || []).length > 0;
      // Until a book is loaded the controller stays EXPANDED on purpose: the
      // stealth dot is undiscoverable on a first run, and the user needs the
      // import button. It collapses to the dot once there is something to read.
      //
      // `view.playing` deliberately does NOT hold it open: auto-scrolling used to
      // pin the rail expanded forever, so it never collapsed when the mouse left.
      const expanded = hover || view.panel !== null || !hasBook;

      // default anchor: bottom-left, out of the way
      const pos = view.pos || { x: 18, y: size.h - 62 };
      const clampedX = Math.max(4, Math.min(pos.x, size.w - (expanded ? 268 : 40)));
      const clampedY = Math.max(4, Math.min(pos.y, size.h - 40));

      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        // ref.current, not e.currentTarget: React invalidates currentTarget once
        // the handler returns, and these fields are read by later events.
        const el = ref.current;
        const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        drag.current = {
          sx: e.clientX,
          sy: e.clientY,
          bx: pos.x,
          by: pos.y,
          w: rect ? rect.width : 40,
          h: rect ? rect.height : 40,
          moved: false,
          fromControl: isInteractiveTarget(e.target),
          el
        };
      };
      const onPointerMove = (e) => {
        const d = drag.current;
        if (!d) return;
        // No button held means this is a hover. Dropping the pending drag here
        // prevents a stale origin from turning ordinary mouse movement into a
        // drag (and then swallowing the next click).
        if (e.buttons === 0) {
          drag.current = null;
          return;
        }
        const dx = e.clientX - d.sx;
        const dy = e.clientY - d.sy;
        if (!d.moved) {
          if (!exceedsDragThreshold(dx, dy, d.fromControl)) return;   // still a click
          d.moved = true;
          try { d.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
        if (e.cancelable) e.preventDefault();
        // clamp with the float's real size so it can never leave the window
        app.movePos(
          Math.max(4, Math.min(d.bx + dx, size.w - d.w - 4)),
          Math.max(4, Math.min(d.by + dy, size.h - d.h - 4))
        );
      };
      const onPointerUp = (e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        try { d.el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        if (!d.moved) return;   // a plain click: let it through untouched
        // A drag that ends over a button would otherwise also deliver a click.
        const el = d.el;
        if (!el || !el.addEventListener) return;
        const swallow = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          el.removeEventListener('click', swallow, true);
        };
        el.addEventListener('click', swallow, true);
        setTimeout(() => el.removeEventListener('click', swallow, true), 350);
      };
      // A press released outside the float never reaches onPointerUp; clear the
      // pending drag so it cannot linger into the next interaction.
      const onPointerLeave = () => {
        const d = drag.current;
        if (d && !d.moved) drag.current = null;
      };

      const btn = (key, label, onClick, active, Icon) => h(IconButton, {
        key, label, onClick, active
      }, h(Icon));

      return h('div', {
        ref,
        style: {
          position: 'absolute',
          left: clampedX, top: clampedY,
          display: 'flex', alignItems: 'center', gap: 2,
          padding: expanded ? '5px 7px' : 0,
          borderRadius: 999,
          background: expanded ? token('--dsw-alias-bg-overlay') : 'transparent',
          border: expanded ? `1px solid ${token('--dsw-alias-border-l3')}` : '1px solid transparent',
          boxShadow: expanded ? '0 8px 24px rgba(0,0,0,0.28)' : 'none',
          backdropFilter: expanded ? 'blur(16px)' : 'none',
          WebkitBackdropFilter: expanded ? 'blur(16px)' : 'none',
          // In stealth the rail fades to a ghost, but hovering still brings it
          // back into view — otherwise stealth would hide its own off-switch.
          opacity: expanded ? (settings.hidden ? 0.55 : 1) : (settings.hidden ? 0.12 : 0.55),
          transition: 'opacity .18s ease, padding .18s ease',
          pointerEvents: 'auto',
          userSelect: 'none',
          cursor: 'grab',
          touchAction: 'none',
          zIndex: 200
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: onPointerUp,
        onPointerLeave
      },
        expanded
          ? [
            h('span', {
              key: 'grip', title: t('dragHint') || '拖动', 'aria-hidden': true,
              style: {
                cursor: 'grab', color: token('--dsw-alias-label-caption'),
                padding: '0 4px', fontSize: 13, lineHeight: '30px'
              }
            }, '⠿'),
            btn('toc', t('toc'), () => app.view.set((v) => ({ ...v, panel: v.panel === 'toc' ? null : 'toc' })), view.panel === 'toc', Icons.toc),
            btn('prev', t('prev'), () => app.gotoChapter(view.chapter - 1), false, Icons.prev),
            btn('play', view.playing ? t('pause') : t('play'), () => app.togglePlay(), view.playing, view.playing ? Icons.pause : Icons.play),
            btn('next', t('next'), () => app.gotoChapter(view.chapter + 1), false, Icons.next),
            btn('lib', t('library'), () => app.view.set((v) => ({ ...v, panel: v.panel === 'library' ? null : 'library' })), view.panel === 'library', Icons.book),
            btn('set', t('settings'), () => app.view.set((v) => ({ ...v, panel: v.panel === 'settings' ? null : 'settings' })), view.panel === 'settings', Icons.gear),
            btn('boss', settings.hidden ? t('show') : t('hide'), () => app.toggleStealth(), settings.hidden, settings.hidden ? Icons.eyeOff : Icons.eye)
          ]
          : [
            h('div', {
              key: 'dot',
              // While playing, the collapsed dot carries the accent colour and a
              // slow pulse: without it a collapsed rail gives no sign that text
              // is still scrolling behind the GUI.
              title: view.playing ? (t('pause') + ' / ' + t('dragHint')) : t('dragHint'),
              style: {
                width: 26, height: 26, borderRadius: 999, cursor: 'grab',
                background: view.playing
                  ? token('--dsw-static-deepseek-450')
                  : token('--dsw-alias-label-caption'),
                opacity: view.playing ? 0.95 : 0.55,
                boxShadow: view.playing ? `0 0 0 3px ${token('--dsw-alias-bg-overlay')}` : 'none',
                touchAction: 'none'
              }
            })
          ]
      );
    }

    /* ────────────────────────── TOC panel ────────────────────────── */

    function TocPanel({ app }) {
      const view = useStore(app.view);
      const listRef = useRef(null);
      const activeRef = useRef(null);

      useEffect(() => {
        if (view.panel !== 'toc') return;
        const el = activeRef.current;
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
      }, [view.panel]);

      if (view.panel !== 'toc') return null;
      const chapters = view.chapters || [];

      return h('div', {
        style: {
          ...panelStyle,
          left: 18, top: 64, maxHeight: 'calc(100vh - 140px)'
        }
      },
        h('div', { style: panelHeadStyle },
          h('span', { style: { flex: '1 1 auto', color: token('--dsw-alias-label-primary') } },
            view.title || t('toc')),
          h('span', { style: { color: token('--dsw-alias-label-caption') } },
            `${view.chapter + 1} / ${chapters.length}`),
          h(IconButton, { label: t('close'), onClick: () => app.view.set((v) => ({ ...v, panel: null })) }, '✕')
        ),
        h('div', { ref: listRef, style: { overflowY: 'auto', padding: '4px 0' } },
          chapters.length === 0
            ? h('div', { style: { padding: 16, color: token('--dsw-alias-label-caption') } }, t('empty'))
            : chapters.map((ch, i) => h('div', {
              key: i,
              ref: i === view.chapter ? activeRef : null,
              onClick: () => { app.gotoChapter(i); app.view.set((v) => ({ ...v, panel: null })); },
              title: ch.title,
              style: {
                padding: '6px 14px', cursor: 'pointer', lineHeight: '18px',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                color: i === view.chapter ? token('--dsw-static-deepseek-450') : token('--dsw-alias-label-secondary'),
                background: i === view.chapter ? token('--dsw-alias-interactive-bg-hover') : 'transparent',
                fontWeight: i === view.chapter ? 600 : 400
              }
            }, ch.title || `${t('chapter')} ${i + 1}`))
        )
      );
    }

    /* ──────────────────────── library panel ──────────────────────── */

    function LibraryPanel({ app }) {
      const view = useStore(app.view);
      const inputRef = useRef(null);
      if (view.panel !== 'library') return null;

      const pick = () => inputRef.current && inputRef.current.click();

      return h('div', { style: { ...panelStyle, left: 18, top: 64 } },
        h('div', { style: panelHeadStyle },
          h('span', { style: { flex: '1 1 auto', color: token('--dsw-alias-label-primary') } }, t('library')),
          h(IconButton, { label: t('open'), onClick: pick }, h(Icons.plus)),
          h(IconButton, { label: t('close'), onClick: () => app.view.set((v) => ({ ...v, panel: null })) }, '✕')
        ),
        h('input', {
          ref: inputRef, type: 'file', accept: '.txt,text/plain', multiple: true,
          style: { display: 'none' },
          onChange: (e) => { app.importFiles(e.target.files); e.target.value = ''; }
        }),
        h('div', { style: { overflowY: 'auto', padding: '4px 0' } },
          view.books.length === 0
            ? h('div', { style: { padding: '14px 16px', lineHeight: '19px', color: token('--dsw-alias-label-caption') } },
              t('empty'), h('br'), h('span', { style: { opacity: 0.75 } }, t('hint')))
            : view.books.map((b) => h('div', {
              key: b.id,
              style: {
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 7px 14px',
                cursor: 'pointer',
                background: b.id === view.bookId ? token('--dsw-alias-interactive-bg-hover') : 'transparent'
              },
              onClick: () => app.loadBook(b.id, true)
            },
              h('span', { style: { flex: '1 1 auto', minWidth: 0 } },
                h('span', {
                  style: {
                    display: 'block', whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: b.id === view.bookId ? token('--dsw-static-deepseek-450') : token('--dsw-alias-label-primary')
                  }
                }, b.title),
                h('span', { style: { fontSize: 11, color: token('--dsw-alias-label-caption') } },
                  `${b.chapterCount} ${t('chapters')} · ${b.encoding} · ${(b.size / 1048576).toFixed(1)} MB`)
              ),
              h(IconButton, {
                label: t('del'),
                onClick: () => app.removeBook(b.id)
              }, h(Icons.trash))
            ))
        )
      );
    }

    /* ─────────────────────── settings panel ─────────────────────── */

    function SettingsPanel({ app }) {
      const view = useStore(app.view);
      const s = useStore(app.settings);
      if (view.panel !== 'settings') return null;

      const set = (patch) => app.persistSettings(patch);
      // Opacity-style values are shown as percentages: "0.02" reads as a small
      // number, "2%" reads as "invisible", which is the actual problem to spot.
      const pct = (v) => Math.round(Number(v) * 100) + '%';
      const num = (key, min, max, step, label, suffix, format) => h(Row, { label },
        h(Slider, { value: s[key], min, max, step, onChange: (v) => set({ [key]: v }) }),
        h('span', {
          style: { width: 46, textAlign: 'right', color: token('--dsw-alias-label-caption'), fontVariantNumeric: 'tabular-nums' }
        }, format ? format(s[key]) : `${s[key]}${suffix || ''}`)
      );

      const hasBook = (view.chapters || []).length > 0;
      const effective = s.hidden ? s.stealthOpacity : s.opacity;
      const tooFaint = effective < 0.06;
      const preset = (label, opacity) => h('button', {
        key: label,
        type: 'button',
        onClick: () => set({ opacity, hidden: false }),
        style: {
          flex: '1 1 0', padding: '5px 0', cursor: 'pointer', fontSize: 12,
          borderRadius: token('--dsw-radius-sm'),
          border: `1px solid ${token('--dsw-alias-border-l3')}`,
          background: Math.abs(s.opacity - opacity) < 0.001
            ? token('--dsw-alias-interactive-bg-hover')
            : 'transparent',
          color: token('--dsw-alias-label-secondary')
        }
      }, label);

      return h('div', { style: { ...panelStyle, left: 18, top: 64, width: 'min(360px, calc(100vw - 32px))' } },
        h('div', { style: panelHeadStyle },
          h('span', { style: { flex: '1 1 auto', color: token('--dsw-alias-label-primary') } }, t('settings')),
          h(IconButton, { label: t('close'), onClick: () => app.view.set((v) => ({ ...v, panel: null })) }, '✕')
        ),
        h('div', { style: { overflowY: 'auto', padding: '6px 0 10px' } },
          // Books on disk but nothing loaded is the other state that looks like a
          // broken plugin while every layer below it is fine. Surface it loudly.
          !hasBook && (view.books || []).length > 0 ? h('div', {
            key: 'noload',
            style: {
              margin: '4px 12px 8px', padding: '8px 10px',
              borderRadius: token('--dsw-radius-md'),
              border: `1px solid ${token('--dsw-static-amber-400')}`,
              background: token('--dsw-alias-bg-layer-2'),
              color: token('--dsw-alias-label-primary'), fontSize: 12, lineHeight: '17px'
            }
          },
            h('div', null, String(t('noLoadWarn')).replace('{n}', String((view.books || []).length))),
            view.status ? h('div', { style: { marginTop: 4, opacity: 0.75 } }, view.status) : null,
            h('button', {
              type: 'button',
              onClick: () => app.loadBook(view.books[0].id, false),
              style: {
                marginTop: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
                borderRadius: token('--dsw-radius-sm'),
                border: `1px solid ${token('--dsw-static-amber-400')}`,
                background: 'transparent', color: token('--dsw-alias-label-primary')
              }
            }, t('retryLoad'))
          ) : null,
          // A loaded book plus a near-zero opacity is the one state where the
          // plugin looks broken though it is working. Say so, and offer the fix.
          hasBook && tooFaint ? h('div', {
            key: 'faint',
            style: {
              margin: '4px 12px 8px', padding: '8px 10px',
              borderRadius: token('--dsw-radius-md'),
              border: `1px solid ${token('--dsw-static-amber-400')}`,
              background: token('--dsw-alias-bg-layer-2'),
              color: token('--dsw-alias-label-primary'), fontSize: 12, lineHeight: '17px'
            }
          },
            h('div', null, String(t('faintWarn')).replace('{p}', String(Math.round(effective * 100)))),
            h('button', {
              type: 'button',
              onClick: () => set({ opacity: 0.2, stealthOpacity: 0.1, hidden: false }),
              style: {
                marginTop: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12,
                borderRadius: token('--dsw-radius-sm'),
                border: `1px solid ${token('--dsw-static-amber-400')}`,
                background: 'transparent', color: token('--dsw-alias-label-primary')
              }
            }, t('faintFix'))
          ) : null,
          h(Row, { label: t('presetHint') },
            h('span', { style: { display: 'flex', gap: '6px', width: '212px' } },
              preset(t('presetReadable'), 0.28),
              preset(t('presetBalanced'), 0.18),
              preset(t('presetStealth'), 0.08))),
          num('fontSize', 14, 72, 1, t('s_size'), 'px'),
          num('opacity', 0.02, 0.8, 0.01, t('s_opacity'), '', pct),
          num('stealthOpacity', 0, 0.4, 0.01, t('s_stealth'), '', pct),
          num('lineHeight', 1.2, 3, 0.05, t('s_line'), ''),
          num('letterSpacing', 0, 0.3, 0.005, t('s_spacing'), 'em'),
          num('scrimAlpha', 0, 0.9, 0.01, t('s_scrimAlpha'), ''),
          num('speed', 4, 400, 2, t('s_speed'), 'px/s'),
          num('wheelStep', 2, 20, 1, t('s_wheel'), '×'),
          num('surfaceClear', 0, 1, 0.02, t('s_surface'), ''),

          h(Row, { label: t('s_color') },
            h('input', {
              type: 'color', value: s.color || '#e6e6e6',
              onChange: (e) => set({ color: e.target.value }),
              style: { width: 34, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }
            }),
            h('button', {
              type: 'button', onClick: () => set({ color: '' }),
              style: {
                fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                borderRadius: token('--dsw-radius-sm'),
                border: `1px solid ${token('--dsw-alias-border-l3')}`,
                background: s.color ? 'transparent' : token('--dsw-alias-interactive-bg-hover'),
                color: token('--dsw-alias-label-secondary')
              }
            }, t('auto'))
          ),

          h(Row, { label: t('s_scrimColor') },
            h('input', {
              type: 'color', value: s.scrimColor,
              onChange: (e) => set({ scrimColor: e.target.value }),
              style: { width: 34, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }
            })
          ),

          h(Row, { label: t('s_font') },
            h('input', {
              type: 'text', value: s.fontFamily, placeholder: 'inherit',
              onChange: (e) => set({ fontFamily: e.target.value }),
              style: {
                width: 150, padding: '4px 8px', fontSize: 12,
                borderRadius: token('--dsw-radius-sm'),
                border: `1px solid ${token('--dsw-alias-border-l3')}`,
                background: token('--dsw-alias-bg-layer-2'),
                color: token('--dsw-alias-label-primary'), outline: 'none'
              }
            })
          ),

          h(Row, { label: t('s_title') },
            h('input', {
              type: 'checkbox', checked: !!s.showChapterTitle,
              onChange: (e) => set({ showChapterTitle: e.target.checked }),
              style: { accentColor: token('--dsw-static-deepseek-450'), cursor: 'pointer' }
            })
          ),
          h(Row, { label: t('s_resume') },
            h('input', {
              type: 'checkbox', checked: !!s.autoResume,
              onChange: (e) => set({ autoResume: e.target.checked }),
              style: { accentColor: token('--dsw-static-deepseek-450'), cursor: 'pointer' }
            })
          ),

          h('div', { style: { padding: '7px 14px' } },
            h('div', { style: { color: token('--dsw-alias-label-secondary'), marginBottom: 5 } }, t('s_re')),
            h('input', {
              type: 'text', value: s.chapterRe, spellCheck: false,
              onChange: (e) => set({ chapterRe: e.target.value }),
              style: {
                width: '100%', boxSizing: 'border-box', padding: '5px 8px',
                fontSize: 11, fontFamily: 'var(--ds-font-family-code)',
                borderRadius: token('--dsw-radius-sm'),
                border: `1px solid ${token('--dsw-alias-border-l3')}`,
                background: token('--dsw-alias-bg-layer-2'),
                color: token('--dsw-alias-label-primary'), outline: 'none'
              }
            }),
            h('div', { style: { marginTop: 6, fontSize: 11, color: token('--dsw-alias-label-caption') } },
              t('bossHint'))
          ),

          h('div', { style: { padding: '8px 14px 2px' } },
            h('button', {
              type: 'button',
              onClick: () => { app.persistSettings({ ...DEFAULTS, hidden: false }); },
              style: {
                width: '100%', padding: '7px 0', cursor: 'pointer', fontSize: 12,
                borderRadius: token('--dsw-radius-md'),
                border: `1px solid ${token('--dsw-alias-border-l3')}`,
                background: 'transparent', color: token('--dsw-alias-label-secondary')
              }
            }, t('s_reset'))
          )
        )
      );
    }

    /* ─────────────────────── drag & drop import ─────────────────────── */

    function DropCatcher({ app }) {
      const view = useStore(app.view);
      const [over, setOver] = useState(false);
      useEffect(() => {
        const onOver = (e) => {
          if (!e.dataTransfer) return;
          const types = Array.from(e.dataTransfer.types || []);
          if (types.indexOf('Files') === -1) return;
          e.preventDefault();
          setOver(true);
        };
        const onLeave = (e) => {
          if (e.relatedTarget) return;
          setOver(false);
        };
        const onDrop = (e) => {
          if (!e.dataTransfer) return;
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length) app.importFiles(e.dataTransfer.files);
        };
        window.addEventListener('dragover', onOver, true);
        window.addEventListener('dragleave', onLeave, true);
        window.addEventListener('drop', onDrop, true);
        return () => {
          window.removeEventListener('dragover', onOver, true);
          window.removeEventListener('dragleave', onLeave, true);
          window.removeEventListener('drop', onDrop, true);
        };
      }, [app]);

      return [
        over ? h('div', {
          key: 'overlay',
          style: {
            position: 'absolute', inset: 0, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 60
          }
        }, h('div', {
          style: {
            padding: '14px 26px', borderRadius: token('--dsw-radius-lg'),
            border: `1.5px dashed ${token('--dsw-static-deepseek-450')}`,
            background: token('--dsw-alias-bg-overlay'),
            color: token('--dsw-alias-label-primary'), fontSize: 14,
            backdropFilter: 'blur(12px)'
          }
        }, t('drop'))) : null,
        view.status ? h('div', {
          key: 'status',
          style: {
            position: 'absolute', left: '50%', bottom: 26, transform: 'translateX(-50%)',
            padding: '7px 16px', borderRadius: 999, fontSize: 12,
            background: token('--dsw-alias-bg-overlay'),
            border: `1px solid ${token('--dsw-alias-border-l3')}`,
            color: token('--dsw-alias-label-secondary'),
            pointerEvents: 'none', zIndex: 60
          }
        }, view.status) : null
      ];
    }

    /* ───────────────────────── shell.overlay ───────────────────────── */

    function Root({ app }) {
      return h(React.Fragment, null,
        h(Controller, { app }),
        h(TocPanel, { app }),
        h(LibraryPanel, { app }),
        h(SettingsPanel, { app }),
        h(DropCatcher, { app })
      );
    }

    /* ───────────────────────────── apply ───────────────────────────── */

    // `shortcuts` and `locale` must be declared here. Reaching them through
    // ctx.get() without declaring them left the boss key unregistered, so
    // Ctrl+Shift+` silently did nothing while the eye button worked.
    const inject = ['slots', 'shortcuts', 'locale'];

    function apply(ctx) {
      // Proof-of-load marker. It lands in the renderer's Local Storage leveldb,
      // which is greppable on disk — so "did the client half load?" is
      // answerable without browser control.
      try {
        localStorage.setItem('dsh-novel-wallpaper:boot', new Date().toISOString());
      } catch {
        /* private mode / storage disabled */
      }
      if (typeof console !== 'undefined' && console.info) {
        console.info('[novel-wallpaper] client half loaded');
      }

      // Prefer the host locale service; fall back to the bundled zh strings.
      const locale = ctx.locale || (ctx.get ? ctx.get('locale') : undefined);
      if (locale && typeof locale.register === 'function') {
        try {
          ctx.effect(() => locale.register('novel-wallpaper', DICT), 'novel-wallpaper: dictionaries');
          t = locale.bind('novel-wallpaper');
        } catch {
          /* keep the built-in strings */
        }
      }

      const app = createApp();

      ctx.effect(() => () => {
        if (app.runtime.raf) cancelAnimationFrame(app.runtime.raf);
        app.cancelWheelAnim();
        const layer = document.getElementById(LAYER_ID);
        if (layer) layer.remove();
        const style = document.getElementById(STYLE_ID);
        if (style) style.remove();
        document.body.removeAttribute(ACTIVE_ATTR);
        document.body.style.removeProperty('--nr-surface-base');
        document.body.style.removeProperty('--nr-surface-alpha');
      }, 'novel-wallpaper: layer');

      // Theme flips redefine --dsw-alias-bg-base; re-snapshot it so the
      // color-mix base stays correct.
      ctx.effect(() => {
        if (typeof MutationObserver === 'undefined') return () => {};
        const obs = new MutationObserver(() => app.refreshSurface());
        obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-dsh-desktop-mode', 'class'] });
        const onResize = () => { app.measure(); app.applyTransform(); };
        window.addEventListener('resize', onResize);
        return () => {
          obs.disconnect();
          window.removeEventListener('resize', onResize);
        };
      }, 'novel-wallpaper: theme');

      // The boss key: one press dims the wallpaper and the controller.
      const shortcuts = ctx.shortcuts || (ctx.get ? ctx.get('shortcuts') : undefined);
      if (shortcuts && typeof shortcuts.register === 'function') {
        try {
          ctx.effect(() => shortcuts.register({
            id: 'novel-wallpaper.boss',
            label: () => '小说壁纸：隐身 / 现身',
            aliases: ['novel wallpaper boss key', 'hide novel', '小说隐身'],
            defaults: {
              'desktop:windows': { code: 'Backquote', modifiers: ['primary', 'shift'] },
              'desktop:macos': { code: 'Backquote', modifiers: ['primary', 'shift'] },
              'desktop:linux': { code: 'Backquote', modifiers: ['primary', 'shift'] },
              'web:windows': { code: 'Backquote', modifiers: ['primary', 'shift'] },
              'web:macos': { code: 'Backquote', modifiers: ['primary', 'shift'] }
            },
            // 'editable' so the boss key still fires while the composer has focus.
            regions: ['page', 'terminal', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: () => app.toggleStealth() })
          }), 'novel-wallpaper: boss key');
        } catch {
          // Best-effort: a rejected binding (e.g. an unsupported web/Linux
          // chord) must not crash the whole plugin — the float's eye button
          // remains the fallback.
        }
      }

      // Arrow keys, routed through the host shortcut service instead of a raw
      // keydown listener. That buys three things a global listener cannot:
      // the chord is focus-aware, conflicts are detected against every other
      // app binding, and the user can rebind it in DSH's own shortcut settings.
      //
      // `regions` deliberately omits 'editable'. Ctrl+Shift+←/→ is "select by
      // word" in any text field, and stealing it inside the composer would make
      // editing worse — so a focused input keeps its arrows, always.
      const readingCommands = [
        { id: 'novel-wallpaper.scroll-up', code: 'ArrowUp', zh: '小说壁纸：向上回看', en: 'Novel wallpaper: scroll back', run: () => app.wheelScroll(-1) },
        { id: 'novel-wallpaper.scroll-down', code: 'ArrowDown', zh: '小说壁纸：向下阅读', en: 'Novel wallpaper: scroll forward', run: () => app.wheelScroll(1) },
        { id: 'novel-wallpaper.prev-chapter', code: 'ArrowLeft', zh: '小说壁纸：上一章', en: 'Novel wallpaper: previous chapter', run: () => app.gotoChapter(app.view.get().chapter - 1) },
        { id: 'novel-wallpaper.next-chapter', code: 'ArrowRight', zh: '小说壁纸：下一章', en: 'Novel wallpaper: next chapter', run: () => app.gotoChapter(app.view.get().chapter + 1) }
      ];
      if (shortcuts && typeof shortcuts.register === 'function') {
        readingCommands.forEach((cmd) => {
          try {
            ctx.effect(() => shortcuts.register({
              id: cmd.id,
              label: () => cmd.zh,
              aliases: [cmd.en.toLowerCase(), cmd.zh],
              defaults: {
                // Only the profiles where Arrow+primary+shift passes the
                // service's own rules. The arrow keys sit on its reserved list
                // outside desktop Windows/macOS, and declaring a default it
                // rejects would fail this command's whole registration.
                'desktop:windows': { code: cmd.code, modifiers: ['primary', 'shift'] },
                'desktop:macos': { code: cmd.code, modifiers: ['primary', 'shift'] },
                'web:windows': { code: cmd.code, modifiers: ['primary', 'shift'] }
              },
              regions: ['page', 'terminal'],
              modals: [],
              resolve: () => ({
                status: 'handled',
                run: () => { cmd.run(); }
              })
            }), 'novel-wallpaper: shortcut ' + cmd.id);
          } catch {
            // Per-command best effort, exactly like the boss key: one platform
            // rejecting a chord must not take the other three commands down.
          }
        });
      }

      // One wheel listener on the window, in the capture phase so we see the
      // gesture before any host scroller does. We only swallow it when we
      // actually moved the novel; every other case falls straight through.
      ctx.effect(() => {
        if (typeof window === 'undefined' || !window.addEventListener) return () => {};
        const onWheel = (e) => {
          if (!e.deltaY) return;
          if (app.settings.get().hidden) return;              // boss key: reading controls go dead
          if (hostConsumesWheel(e.target, e.deltaY)) return;  // something above us still wants it
          if (app.wheelScroll(e.deltaY > 0 ? 1 : -1) && e.cancelable) e.preventDefault();
        };
        window.addEventListener('wheel', onWheel, { passive: false, capture: true });
        return () => window.removeEventListener('wheel', onWheel, { capture: true });
      }, 'novel-wallpaper: wheel');

      // Restore the last book once the host is up.
      ctx.effect(() => {
        let alive = true;
        const progress = app.view.get().progress;
        const books = app.view.get().books;
        const target = progress.activeId && books.some((b) => b.id === progress.activeId)
          ? progress.activeId
          : (books[0] && books[0].id);
        if (target) {
          app.loadBook(target, true).catch((err) => {
            app.note('restore-load-rejected', {
              target,
              message: String((err && err.message) || err)
            });
            app.view.set((v) => ({ ...v, status: '载入失败: ' + String((err && err.message) || err) }));
          });
        } else {
          app.draw();
        }
        app.note('restore', { books: books.length, activeId: progress.activeId || null, target: target || null });
        return () => { alive = false; };
      }, 'novel-wallpaper: restore');

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'novel-wallpaper',
        order: 900
      }, () => h(Root, { app })));
    }

    // Exposed for the headless test harness (test/logic.test.mjs). The module
    // loader ignores extra keys; nothing in the Harness reads this.
    return { inject, apply, __internals: { decodeTxt, splitChapters, hexToRgba, DEFAULTS, createApp, exceedsDragThreshold, isInteractiveTarget, surfaceAlphaPercent, hostConsumesWheel } };
  }
});
