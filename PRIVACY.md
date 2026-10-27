# 隐私政策 / Privacy Policy

**剪贴板键入助手 / Clipboard Typing Assistant**  
最后更新：2026-10-27

## 中文

### 我们处理什么

本扩展只在用户主动触发时处理数据：

- 用户点击右键菜单「从剪贴板输入（模拟键盘）」；或
- 用户按下快捷键 `Alt+Shift+V`。

触发后，扩展读取剪贴板中的文本，并以模拟键盘输入的方式写入当前网页的输入框。该文本仅在本次操作的内存中短暂使用，操作完成后即释放。

### 我们不做什么

- 不收集、不存储、不传输剪贴板内容；读取仅用于完成用户请求的本次输入。
- 不收集浏览历史、页面内容、按键记录、位置、账号或其他个人身份信息。
- 不包含统计、分析、广告或跟踪代码。
- 不发起任何网络请求，不加载远程代码；所有代码都打包在扩展内。

### 本地设置

扩展使用浏览器提供的 `chrome.storage.sync` 保存两个偏好设置：

- 输入方式（逐字键入 / 整段输入）
- 输入间隔（0–120 毫秒）

这些设置可能通过浏览器账号同步，其中不包含剪贴板内容或网页内容。

### 数据保留

剪贴板文本只在内存中短暂处理，输入完成后即释放；扩展不会保留副本。

### 联系方式

如有疑问，请在项目仓库提交 Issue：  
https://github.com/Panini-pig/clipboard-typing-assistant/issues

## English

### What we process

The extension processes data only when the user explicitly triggers it:

- by clicking the context menu item "Input from clipboard (simulated keyboard)", or
- by pressing the `Alt+Shift+V` shortcut.

It then reads the clipboard text and types it into the focused input on the current page.

### What we do not do

- We do not collect, store, or transmit clipboard contents.
- We do not collect browsing history, page content, keystrokes, location, account information, or any other personally identifiable information.
- We do not include analytics, tracking, or advertising code.
- We do not make network requests or load remote code. All code is packaged with the extension.

### Local settings

The extension uses the browser's `chrome.storage.sync` to store two preferences:

- input mode (character-by-character / whole text)
- typing delay (0–120 ms)

These settings may sync through the browser account. They never contain clipboard or page content.

### Data retention

Clipboard text is processed in memory only and released after typing. No copy is retained.

### Contact

For questions, please open an issue:  
https://github.com/Panini-pig/clipboard-typing-assistant/issues
