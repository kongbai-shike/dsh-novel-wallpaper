# dsh-novel-wallpaper

把 TXT 小说变成 DSH Desktop 的「壁纸」，用一个会隐身的小浮窗遥控。

- 小说正文渲染在**界面背后**（`document.body` 上 `z-index:-2` 的穿透层），靠清空不透明的
  `--dsw-alias-bg-base` 让它透出来 —— 和已安装的 `dsh-plugin-wallpaper-engine` 同一套
  经过验证的做法。Windows 上壳层材质只接受 `off`，所以透明**纯靠 CSS**，不依赖系统亚克力。
- 浮窗只做遥控：目录 / 上一章 / 自动播放·暂停 / 下一章 / 书库 / 设置 / 隐身。
  平时缩成一个半透明小圆点，鼠标悬停才展开，可拖动。

## 用法

1. 把 `.txt` 文件**拖到窗口任意位置**，或点浮窗 → 书库 → `＋` 导入。
2. 在目录里选一章，点 ▶ 开始自动上下滚动；到本章结尾会**自动停住**（不会自己跳章）。
3. 再点一次 ▶（或 ❚❚）暂停。

编码是自动识别的：UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE，失败则回退 **GB18030**
（中文 TXT 的常态，GBK 会乱码就是因为没做这一步）。

## 老板键

`Ctrl + Shift + \`` 切「隐身档」：文字不透明度降到 **10%**（即 90% 透明）、浮窗淡到几乎看不见，
再按一次恢复。隐身档的具体数值在设置里可调；把它调成 0 就会**彻底还原成原版 DSH 界面**。

## 设置（浮窗 → ⚙）

字号、文字不透明度、隐身档不透明度、字体颜色（或跟随主题）、字体、行距、字间距、
阅读器背景色与浓度、滚动速度、界面清底程度、显示章节标题、记住阅读进度、分章正则。

分章正则默认 `^[ \t\u3000]*(第[0-9一二三四五六七八九十百千零〇两]+[章节回卷篇]|Chapter\s+\d+)`，
只匹配行首，所以正文里提到「第一章」不会被误判成章节。

## 隐私

纯客户端插件：正文存在浏览器 **IndexedDB**，进度和设置存在 **localStorage**。
不写 session log、不给模型任何工具、host 侧 `apply()` 是空的 —— agent 在结构上读不到你在看什么。
（用 localStorage 存正文是不行的，TXT 动辄 5–20MB，会直接爆配额。）

## 安装位置与回滚

真正的代码在 `<plugin-dir>`，
通过 junction 挂到 profile：

```
<DSH_HOME>
  -> <plugin-dir>
```

profile 里改了两处（`package.json` 的 `dependencies` + `dsh.profile.bundles`，
`cordis.patch.yml` 追加了一条 `insert`）。

**回滚**：删掉那个 junction，再把上面两处改动删掉，重启应用即可。
安装前的原始文件备份在
`<DSH_HOME>`。

## 开发

```powershell
node test\logic.test.mjs      # 解码、分章、配色（11 项）
node test\apply.smoke.mjs     # apply() + 壁纸层 + 自动滚动（14 项，带 DOM stub）
```

改完 `client.js` 后**必须同步到上面的安装目录**（两边是两份文件，不是链接目标以外的别名）：

```powershell
Copy-Item .\client.js "<plugin-dir>" -Force
```

## 已知限制

- 只有**对话主区**被清成透明；侧边栏保持不透明（更隐蔽，也不影响可读性）。
  想让侧栏也透，需要在 `LAYER_CSS` 里补 `.dshDesktopSidebarSurface` 的规则。
- 目录一次性渲染全部章节。上万章的巨型文本可能略有卡顿。
- 与 `dsh-plugin-wallpaper-engine` **不叠加**：本插件不透出图片壁纸。两者都想用的话，
  需要把本层的 `z-index` 抬到图片壁纸层之上。
