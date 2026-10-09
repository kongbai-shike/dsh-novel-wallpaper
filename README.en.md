# dsh-novel-wallpaper

English | [中文](README.md)

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4C6EF5.svg)](https://github.com/topics/dsh-plugin)
[![stars](https://img.shields.io/github/stars/kongbai-shike/dsh-novel-wallpaper?style=flat)](https://github.com/kongbai-shike/dsh-novel-wallpaper/stargazers)

> Turns a `.txt` novel into DSH's wallpaper. The text sits **behind** the whole interface; a
> stealthy little float drives it.

Read a page or two while the model is thinking — no second window, no tab switching, and it
never takes over the conversation area. Move the mouse away and the interface is just the
interface again.

---

## Contents

- [What it looks like](#what-it-looks-like)
- [Install](#install)
- [Quick start](#quick-start)
- [Reading controls: wheel and arrow keys](#reading-controls-wheel-and-arrow-keys)
- [Boss key](#boss-key)
- [Settings](#settings)
- [Chapter rules](#chapter-rules)
- [Privacy](#privacy)
- [Compatibility](#compatibility)
- [Design trade-offs](#design-trade-offs)
- [Development](#development)
- [Known limitations](#known-limitations)
- [Feedback](#feedback)
- [License](#license)

---

## What it looks like

The novel renders as a full-frame text layer pinned to `document.body` at `z-index: -2`,
with `pointer-events: none` — it **never touches the mouse**, so every click lands on the
real interface. A dimming scrim sits above it (`z-index: -1`), then DSH's own UI.
The conversation surface's opaque background is cleared, so the text shows through.

The controller is a float:

| State | Behaviour |
|---|---|
| Idle | A small translucent dot, barely in the way |
| Hover | Expands into a button strip: TOC / prev / ▶ / next / library / ⚙ / hide |
| Stealth | Almost invisible, but still clickable — otherwise you could never get it back |
| Position | Draggable, and remembered |

> **Screenshots are still missing.** If you install this and want to contribute a couple,
> drop them in `assets/` and add a `screenshots.json` per the
> [listing conventions](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md),
> and the market's detail view will use yours.

---

## Install

```sh
dsh plugin --profile web add github:kongbai-shike/dsh-novel-wallpaper
```

**Refresh the page afterwards** — most of the time no restart is needed.

<details>
<summary>Other ways to install</summary>

**A different profile:** replace `--profile web` with your profile name (desktop clients often
use `desktop`).

**From a local checkout:** link the repo into the profile's `node_modules` and register it in
the profile's `package.json` under both `dependencies` and `dsh.profile.bundles`. DSH's HMR
reloads the client half whenever you edit `client.js`.

**Uninstall:** `dsh plugin --profile web remove @local/dsh-novel-wallpaper`, or remove it from
Settings → Plugins.

</details>

**Requires** DSH Web `0.1.0-rc.6` or newer (it uses the `shell.overlay` slot and the client
shortcut service).

---

## Quick start

1. **Drag a `.txt` anywhere onto the window**, or click the float → library → `＋`.
2. Pick a chapter in the table of contents, press ▶ to start auto-scrolling.
3. The wheel or the arrow keys take over at any time; press ▶ / ❚❚ again to pause.

**Encoding is detected automatically**: UTF-8, UTF-8 BOM, UTF-16LE, UTF-16BE, falling back to
**GB18030**. That last step is why Chinese `.txt` files don't come out as mojibake — most older
novels are GBK/GB18030, not UTF-8.

**Auto-scroll stops at the end of a chapter** rather than advancing on its own. That's
deliberate: where you read to is your call.

---

## Reading controls: wheel and arrow keys

| Input | Effect |
|---|---|
| Wheel ↓ | Read forward (text moves up) |
| Wheel ↑ | Read back (text moves down) |
| `Ctrl + Shift + ↓` | Read forward |
| `Ctrl + Shift + ↑` | Read back |
| `Ctrl + Shift + ←` | Previous chapter |
| `Ctrl + Shift + →` | Next chapter |

One notch / one press moves **scroll speed × wheel sensitivity** (adjustable, default 6×),
eased into place over ~180ms. A fast sequence **accumulates** instead of restarting, so it
feels like one continuous glide rather than a series of jumps.

Four behaviours worth knowing:

- **The wheel yields.** While the hovered area can still scroll that way (the transcript,
  a settings panel, the contents list) the wheel belongs to the interface; only once it hits
  the end — or you're over empty space — does it become the novel's. So "scroll the chat to the
  bottom, keep going" hands over naturally, with no mode switch. This is **required**, not a
  nicety: the novel is painted behind the entire GUI, and a global grab would kill chat scrolling.
- **Scrolling during auto-play pauses it first** and hands you the wheel.
- **Stealth makes the wheel and arrow keys inert** — the point of the boss key is to give the
  screen back completely.
- **Arrow keys require `Ctrl + Shift` and never fire inside a text field.** `Ctrl+Shift+←/→` is
  "select by word" while typing; stealing it would make editing worse, so a focused input keeps
  its cursor movement.

The arrow keys register through DSH's own **shortcut service**, not a global key listener. That
makes them focus-aware, conflict-checked against every other binding, and rebindable in
**Settings → Shortcuts**. Command ids:

```
novel-wallpaper.scroll-up    novel-wallpaper.scroll-down
novel-wallpaper.prev-chapter novel-wallpaper.next-chapter
```

> Arrow codes are on that service's **reserved list**, and only `desktop:windows`,
> `desktop:macos` and `web:windows` pass its validation — so those are the only defaults
> declared. Other platforms can bind them in settings.

---

## Boss key

```
Ctrl + Shift + `
```

Toggles stealth: text opacity drops to **10%** (i.e. 90% transparent) and the float fades to
nearly invisible. Press again to restore.

The stealth opacity is configurable — **set it to 0 and the interface is fully restored to
stock DSH.** Stealth is never persisted: a reload always comes back to normal, so the float can
never be lost.

---

## Settings

Float → ⚙. Everything is stored in `localStorage`, on this machine only.

| Group | Options |
|---|---|
| Text | Font size (34), text opacity (0.18), colour (or follow the host theme), font family, line height (1.9), letter spacing (0.02) |
| Background | Reader background colour (`#000000`), background strength (0.35), surface clearing (1) |
| Scrolling | Scroll speed (38 px/s), wheel sensitivity (6×) |
| Stealth | Stealth opacity (0.1) |
| Reading | Show chapter title, remember reading position, chapter-splitting regex |
| Presets | Readable / Balanced / Very hidden, one click |

The default **chapter regex** is the union of every "safe" rule in the built-in table. It only
matches at the start of a line, so a mention of "第一章" inside prose isn't mistaken for a new
chapter. See [Chapter rules](#chapter-rules) for the table, the auto-detect fallback and the
measured numbers.

"Surface clearing" is **inverted**: `1` clears the conversation background completely (clearest
text, most transparent interface). Lower it and the interface becomes solid again, dimming the
novel with it.

---

## Chapter rules

Chapter headings in the wild are a mess, so the plugin ships a rule table. The default is the
**union of every "safe" rule** in it — import a book and it usually just works.

| Rule | Matches | Examples |
|---|---|---|
| 第 N 章 | `第` + optional spaces + digits + optional spaces + `章节回卷篇` | `第31章 九叔的二徒弟`, `第 31 章`, `第１２章`, `第一回` |
| Volume / part | same, unit is `卷部篇` | `第二卷 风起` |
| Prologue / extras | the usual one-off headings | `楔子`, `序章`, `引子`, `尾声`, `终章`, `完本感言` |
| Bracketed | wrapped in brackets | `【第12章】降伏`, `（第 13 章）风叔` |
| Chapter N | English | `Chapter 12 Dawn` |

**The spaces around the digits are the whole point.** Dumps very often write
`第 31 章 标题`, and a tight `第N章` matches none of them — worse, it fails *silently*: a
486-chapter book imports as a single "全文" chapter and nothing anywhere reports an error.
That was a real bug in this plugin.

**Bare-number headings** (`12、开端`, `001.`, `12、`) are their own rule but are **off by
default**: a lone number at the start of a line is occasionally body text, so it's opt-in.

### Auto-detect fallback

If the configured regex finds no usable headings in your book (fewer than 2), the plugin tries
every built-in rule, picks the best one by "most matches whose lines are mostly short", and then:

- re-splits the book with it;
- says in the status line which rule it used — it never silently ignores the regex you wrote.

Candidates must have at least half of their matches on short lines (≤ 40 characters) — a whole
paragraph can't qualify. If every rule's "headings" turn out to be body text, it refuses to guess
and leaves the book alone: a wrong guess is worse than no split.

### Changing the rule needs no re-import

Editing the chapter regex in Settings **re-splits the book immediately** and writes the result
back to the library. Below the regex field is a row of built-in rules — one click each — and you
can still type any regex you like.

Displayed titles are cleaned up first:

- `第 31 章 九叔的二徒弟` → `第31章 九叔的二徒弟` (space between number and unit removed);
- `【第12章】标题` → `第12章 标题` (brackets unwrapped);
- when the heading is glued to its first paragraph (`第1章 标题　　正文…`), only the heading is kept.

### Measured

《同穿：我的名字响彻诸天》 (3.0 MB / 1.06M characters):

| | Chapters | Result |
|---|---|---|
| Before | **1** | the entire book as one "全文" blob, 1.06M characters of unscrollable text |
| After | **482** | preface + 481 chapters, longest title 22 characters, nothing lost |

> The book is numbered up to 486, but chapters 119 / 166 / 167 / 371 / 439 **are missing from
> the source file itself** (a common defect in pirated TXT dumps), which is not a splitting
> error. The 481 chapters the plugin finds are every chapter that actually exists in the file.

---

## Privacy

**A pure client-side plugin.** The host half's `apply()` is empty.

- Novel text lives in the browser's **IndexedDB** (a 5–20MB `.txt` would blow past the
  `localStorage` quota)
- Progress and settings live in **localStorage**
- **It writes no session log, registers no tools, and gives the model no entry point**

In other words: **the agent structurally cannot see what you're reading.** That isn't a promise
to not look — the path simply isn't built. All parsing, chapter splitting and rendering happen in
the browser, with no network involved.

---

## Compatibility

- Targets the **DSH Web GUI** — `dsh web` in a browser, and desktop clients that embed the same
  interface.
- Verified running against DSH Web `0.1.7-rc.2` (React 18.3.1); requires `0.1.0-rc.6` or newer.
- Transparency is **pure CSS**: opaque tokens like `--dsw-alias-bg-base` are cleared so the layer
  below shows through. It does not rely on system acrylic/vibrancy, so it works on Windows even
  with shell material set to `off`.
- It does **not** stack with `dsh-plugin-wallpaper-engine`: this plugin doesn't reveal image
  wallpapers. To use both, raise this layer's `z-index` above the image wallpaper layer.

---

## Design trade-offs

A few things look less clever than they could be, on purpose:

**Why doesn't the wheel just grab everything?**
Because the novel is *behind* everything. A global `wheel` listener would swallow scrolling in the
transcript, the settings panels and the contents list — unacceptable. So it arbitrates instead:
walk up from the hovered node, and if any ancestor can still scroll that direction, hand it back.
Only when nothing wants it does the novel take it. The cost is one DOM walk; the payoff is two
scroll systems coexisting without fighting.

**Why doesn't it advance at the end of a chapter?**
Auto-advance means glancing away for a message and coming back having lost your place. Stopping
at the chapter end is the safe side of that trade.

**Why do the arrow keys need a modifier?**
Without one, pressing ↑ in the composer would page the novel instead of the input history, and the
caret would jump. Narrow benefit, broad breakage — so a chord is required, and the `editable`
region isn't registered at all.

**Why do rapid notches accumulate?**
The first version retargeted each animation from the *previous animation's origin*, so every
notch erased the progress of the last one — the faster you scrolled, the less it moved. It now
retargets from the **currently painted position**, so consecutive input folds into one motion.

---

## Development

```sh
node test/logic.test.mjs      # decoding / chapter splitting / dictionary / colour   24 checks
node test/apply.smoke.mjs     # load / layer / scrolling / wheel / shortcuts   35 checks (DOM stub)
```

Both are zero-dependency `node` scripts — run them directly, install nothing.
`apply.smoke.mjs` builds its own minimal DOM stub covering the transparency draw paths, the
wheel's clamping and arbitration, the shape of the shortcut registrations, and whether teardown
leaves anything behind.

**Layout:**

```
client.js          # everything: text layer, float, reading engine, settings panel (browser half)
index.js           # host half; apply() is empty
cordis.patch.yml   # the dsh.bundle manifest that mounts the plugin
test/              # two zero-dependency test scripts
```

Changes concentrate in `client.js`. It's one `factory(require)` closure, uses React through
`h = createElement`, and exports `__internals` for headless tests.

---

## Known limitations

- Only the **main conversation area** is cleared; the sidebar stays opaque (more discreet, and
  easier to read). To clear it too, add a `.dshDesktopSidebarSurface` rule in `LAYER_CSS`.
- The table of contents renders every chapter at once. Very large texts (tens of thousands of
  chapters) may stutter slightly.
- Reading position is tracked per book and chapter, and doesn't sync across devices — nor should
  it, since the text only exists on this machine.
- TXT only, no images or EPUB. That's a trade: TXT parsing runs entirely locally and leaves no
  network traffic.

---

## Feedback

- **Bugs / feature requests**: open an [issue](https://github.com/kongbai-shike/dsh-novel-wallpaper/issues).
  Include your DSH version, your OS, and how to reproduce it.
- **PRs** are welcome. Run the two tests above before you start; if you add behaviour, add a case
  with it — the suite is zero-dependency, so a new check is cheap.

---

## ⭐ If this is your kind of thing

This plugin started from something very simple: **I wanted to read a page or two while waiting
for the model, without opening another window.**

If that thought has crossed your mind too, this was probably written for you.

**I'd love for it to earn a star from you.** It won't make me any money, but it tells me
"I'm not the only one who needed this" — which is the reason to keep grinding on what's still
owed: finer wheel feel, better large-type layout, several books at once, chapter volumes in the
TOC.

One star is one reason to keep going. Thank you.

---

## License

[MIT](LICENSE)
