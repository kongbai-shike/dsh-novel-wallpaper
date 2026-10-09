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
});const { decodeTxt, splitChapters, splitChaptersAuto, cleanTitle, detectChapterRe, CHAPTER_RULES, DICT, hexToRgba, DEFAULTS } = mod.__internals;

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

// A missing dictionary key is invisible at runtime: t() falls back to returning
// the key itself, so the panel silently renders "rule_cn-vol" as a button label.
check('every t() key in client.js exists in both locales', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'client.js'), 'utf8');
  const keys = new Set();
  for (const m of src.matchAll(/(?:^|[^\w$.])t\('([^']+)'\)/g)) keys.add(m[1]);
  if (/t\('rule_' \+/.test(src)) {
    keys.add('rule_custom');
    keys.add('rule_default');
    for (const r of CHAPTER_RULES) keys.add('rule_' + r.id);
  }
  const missing = [];
  for (const k of keys) {
    if (DICT.zh[k] === undefined) missing.push('zh:' + k);
    if (DICT.en[k] === undefined) missing.push('en:' + k);
  }
  assert.deepEqual(missing, [], 'missing dictionary entries: ' + missing.join(', '));
  assert.ok(keys.size > 40, 'sanity: the scan should find the whole dictionary surface');
});

// The preset buttons are driven by the rule table, so the two must not drift.
check('every chapter rule has an id, a pattern and a label', () => {
  assert.ok(CHAPTER_RULES.length >= 5);
  const ids = new Set();
  for (const r of CHAPTER_RULES) {
    assert.ok(r.id && !ids.has(r.id), 'rule ids must be unique: ' + r.id);
    ids.add(r.id);
    assert.ok(DICT.zh['rule_' + r.id], 'missing zh label for rule ' + r.id);
    assert.ok(DICT.en['rule_' + r.id], 'missing en label for rule ' + r.id);
    assert.doesNotThrow(() => new RegExp(r.source), 'rule ' + r.id + ' must compile');
  }
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

console.log('splitChapters — heading styles seen in real TXT dumps');

// The regression that motivated the rule table: a 486-chapter dump writes
// "第 31 章 标题" with spaces around the digits. The old tight `第N章` pattern
// matched ZERO of them, so the whole 1.06M-character book imported as a single
// "全文" chapter with no error reported anywhere.
check('splits "第 N 章" — spaces around the digits', () => {
  const text = '第 1 章 九叔的二徒弟\n　　正文一\n第 2 章 外挂来了？\n正文二\n第 486 章 死神世界后记\n正文三';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 3, 'expected 3 chapters, got ' + ch.length);
  assert.equal(ch[0].title, '第1章 九叔的二徒弟');
  assert.equal(ch[1].title, '第2章 外挂来了？');
  assert.equal(ch[2].title, '第486章 死神世界后记');
});

check('handles full-width digits, 节 and 卷', () => {
  const text = '第１２章 全角\nA\n第 3 节 转折\nB\n第 2 卷 风起\nC\n楔子\nD';
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 4, 'expected 4 chapters, got ' + ch.length);
  assert.equal(ch[0].title, '第１２章 全角');
  assert.equal(ch[1].title, '第3节 转折');
  assert.equal(ch[2].title, '第2卷 风起');
  assert.equal(ch[3].title, '楔子');
});

check('detects a bracketed heading and unwraps it', () => {
  const ch = splitChapters('【第12章】降伏\nA\n（第 13 章）风叔\nB', DEFAULTS.chapterRe);
  assert.equal(ch.length, 2);
  assert.equal(ch[0].title, '第12章 降伏');
  assert.equal(ch[1].title, '第13章 风叔');
  assert.equal(cleanTitle('（第 7 章）'), '第7章');
});

check('cuts a heading glued to its first paragraph', () => {
  const body = '　　正文从这里开始，这一段必须足够长，长到不可能是一个章节标题，否则这个启发式就不该触发。';
  const text = `第 1 章 标题${body}\n下一行`;
  const ch = splitChapters(text, DEFAULTS.chapterRe);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].title, '第1章 标题');
});

check('keeps a double space that belongs to the title, not to a body break', () => {
  assert.equal(cleanTitle('第 9 章 上　　下'), '第9章 上 下');
});

console.log('splitChaptersAuto / detectChapterRe');

check('auto-detects a built-in rule when the configured pattern matches nothing', () => {
  const text = '12、开端\nA\n13、发展\nB\n14、结局\nC';
  const r = splitChaptersAuto(text, DEFAULTS.chapterRe);
  assert.equal(r.ruleId, 'cn-num');
  assert.equal(r.count, 3);
  assert.equal(r.chapters[0].title, '12、开端');
});

check('does not auto-detect when the configured pattern already splits', () => {
  const r = splitChaptersAuto('第一章 甲\nA\n第二章 乙\nB', DEFAULTS.chapterRe);
  assert.equal(r.ruleId, null);
  assert.equal(r.chapters.length, 2);
});

check('refuses to guess when every candidate only matches paragraph-length lines', () => {
  const long = '啊'.repeat(60);
  assert.equal(detectChapterRe(`番外${long}\n后记${long}\n终章${long}`), null);
});

check('detectChapterRe reports the rule it would use, not the raw count', () => {
  const text = '第 1 章 甲\nA\n第 2 章 乙\nB\n第 3 章 丙\nC';
  const hit = detectChapterRe(text);
  assert.ok(hit, 'expected a detection');
  assert.equal(hit.count, 3);
  assert.ok(hit.shortRatio >= 0.8);
});

check('a customized pattern that matches is left alone by splitChaptersAuto', () => {
  const text = '◆ 1 ◆\nA\n◆ 2 ◆\nB';
  const r = splitChaptersAuto(text, '^[ \\t\\u3000]*◆[ \\t\\u3000]*\\d+');
  assert.equal(r.ruleId, null);
  assert.equal(r.chapters.length, 2);
  assert.equal(r.chapters[0].title, '◆ 1 ◆');
});

console.log('hexToRgba');

check('expands shorthand and applies alpha', () => {
  assert.equal(hexToRgba('#000', 0.5), 'rgba(0, 0, 0, 0.5)');
  assert.equal(hexToRgba('#ffffff', 1), 'rgba(255, 255, 255, 1)');
  assert.equal(hexToRgba('1a2b3c', 0.25), 'rgba(26, 43, 60, 0.25)');
});

console.log('');
console.log(pass + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
