/**
 * Headless tests for the pure logic in client.js: encoding detection, chapter
 * splitting, color conversion. These are the parts most likely to be wrong in a
 * way that only shows up after a user imports a real (GBK) novel.
 *
 *   node test/logic.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (cfg) => { captured = cfg; } } };

const ReactStub = {
  createElement: () => null,
  Fragment: {},
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useCallback: (f) => f,
  useSyncExternalStore: () => undefined
};

await import('../client.js');
assert.ok(captured, 'client.js should call window.__ModuleLoader__.load');
assert.equal(captured.id, '@local/dsh-novel-wallpaper');

const mod = captured.factory((name) => {
  if (name === 'react') return ReactStub;
  throw new Error('unexpected require: ' + name);
});const { decodeTxt, splitChapters, hexToRgba, DEFAULTS } = mod.__internals;

let pass = 0;
const check = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log('  ok   ' + name);
  } catch (err) {
    console.log('  FAIL ' + name + '\n       ' + err.message);
    process.exitCode = 1;
  }
};

console.log('manifest');

// Regression guard for the bug that made the client half silently never load:
// dsh-client-modules locates the manifest with
//   createRequire(base).resolve('<pkg>/package.json')
// so a package that declares `exports` MUST also export "./package.json".
// Omitting it throws ERR_PACKAGE_PATH_NOT_EXPORTED, which the scanner swallows
// (resolveMeta returns null with NO log line), and the plugin is skipped.
check('exports "./package.json" so the client-module scanner can find the manifest', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  if (pkg.exports !== undefined) {
    assert.ok(
      pkg.exports['./package.json'],
      'with an "exports" map present, "./package.json" must be exported or the client half never loads'
    );
  }
  assert.ok(pkg.dsh && pkg.dsh.client, 'dsh.client must be declared');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.ok(pkg.exports['./client'], 'dsh.client requires an exported "./client" bundle');
});

console.log('decodeTxt');

check('plain UTF-8 Chinese', () => {
  const buf = new TextEncoder().encode('第一章 开始\n正文内容');
  const r = decodeTxt(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(r.text, '第一章 开始\n正文内容');
  assert.equal(r.encoding, 'utf-8');
});

check('UTF-8 with BOM', () => {
  const body = new TextEncoder().encode('中文');
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...body]);
  const r = decodeTxt(withBom.buffer);
  assert.equal(r.text, '中文');
  assert.match(r.encoding, /BOM/);
});

check('GB18030 bytes fall back correctly', () => {
  // "第一章" in GB2312/GBK: B5DA D2BB D5C2
  const gbk = new Uint8Array([0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2]);
  // sanity: these bytes must NOT be valid UTF-8, else the probe is meaningless
  let utf8Ok = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(gbk); } catch { utf8Ok = false; }
  assert.equal(utf8Ok, false, 'precondition: GBK bytes must fail strict UTF-8');
  const r = decodeTxt(gbk.buffer);
  assert.equal(r.text, '第一章');
  assert.equal(r.encoding, 'gb18030');
});

check('UTF-16LE with BOM', () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x2c, 0x7b, 0xe0, 0x7a]); // 第 U+7B2C, 章 U+7AE0
  const r = decodeTxt(bytes.buffer);
  assert.equal(r.text, '第章');
  assert.equal(r.encoding, 'utf-16le');
});

console.log('splitChapters');

check('splits on 第N章 and keeps a preface', () => {
  const text = '简介段落\n\n第一章 开端\n正文一\n\n第二章 发展\n正文二\n\n第三章 结尾\n正文三';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 4, 'preface + 3 chapters, got ' + ch.length);
  assert.equal(ch[0].preface, true);
  assert.equal(ch[0].start, 0);
  assert.equal(ch[1].title, '第一章 开端');
  assert.equal(ch[3].title, '第三章 结尾');
  assert.equal(ch[3].end, text.length);
  // a chapter must start on its own heading line, never on the blank line before
  assert.equal(text[ch[1].start], '第', 'chapter must start at the heading, not the newline');
  assert.equal(text[ch[2].start], '第');
  // offsets must tile the text with no gaps
  for (let i = 0; i < ch.length; i += 1) {
    if (i > 0) assert.equal(ch[i].start, ch[i - 1].end);
  }
});

check('handles Chinese numerals and 节/回', () => {
  const text = '第一回 起源\nA\n第二节 转折\nB\n第三百章 终局\nC';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 3);
  assert.equal(ch[0].title, '第一回 起源');
  assert.equal(ch[1].title, '第二节 转折');
  assert.equal(ch[2].title, '第三百章 终局');
});

check('English "Chapter N"', () => {
  const text = 'Chapter 1 Dawn\nA\nChapter 2 Dusk\nB';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 2);
  assert.equal(ch[0].title, 'Chapter 1 Dawn');
});

check('does not match a mid-line mention', () => {
  const text = '他翻到第一章的时候停住了\n第二章 后面\n正文';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  // "第一章" appears mid-line -> must NOT be a chapter mark, so preface + 1
  assert.equal(ch.length, 2, 'expected preface + one chapter, got ' + ch.length);
  assert.equal(ch[1].title, '第二章 后面');
});

check('falls back to a single chapter when nothing matches', () => {
  const text = '一段没有任何章节标题的长文本。';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].start, 0);
  assert.equal(ch[0].end, text.length);
});

check('bad regex does not throw', () => {
  const ch = splitChapters('第一章 甲\nA\n第二章 乙\nB', '([unclosed');
  assert.ok(Array.isArray(ch) && ch.length >= 1);
});

console.log('hexToRgba');

check('expands shorthand and applies alpha', () => {
  assert.equal(hexToRgba('#000', 0.5), 'rgba(0, 0, 0, 0.5)');
  assert.equal(hexToRgba('#ffffff', 1), 'rgba(255, 255, 255, 1)');
  assert.equal(hexToRgba('1a2b3c', 0.25), 'rgba(26, 43, 60, 0.25)');
});

console.log('');
console.log(pass + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
