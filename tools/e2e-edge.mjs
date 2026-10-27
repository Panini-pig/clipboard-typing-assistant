/* 通过 Edge DevTools Protocol 对扩展做端到端冒烟测试。
 * 用法：node tools/e2e-edge.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXT = path.join(ROOT, 'extension');
const PROFILE = path.join(ROOT, '.edge-test-profile');
const OUT = path.join(ROOT, 'tools', 'out');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const LANG = process.env.EDGE_LANG || 'zh-CN';
const TEST_URL = 'http://127.0.0.1:8123/test/paste-blocked.html';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.closed = false;
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      const key = (message.sessionId || '') + '|' + message.method;
      for (const fn of this.listeners.get(key) || []) fn(message.params);
    });
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const { reject } of this.pending.values()) reject(new Error('CDP closed'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('CDP closed'));
    const id = ++this.nextId;
    const operation = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    return Promise.race([
      operation,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`CDP 超时：${method}`)), 25000)
      ),
    ]);
  }

  on(sessionId, method, fn) {
    const key = (sessionId || '') + '|' + method;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(fn);
  }

  close() {
    try {
      this.ws.close();
    } catch (_) {
      /* ignore */
    }
  }
}

async function findExtensionWorker(cdp, names, timeoutMs) {
  const wanted = Array.isArray(names) ? names : [names];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    for (const target of targetInfos) {
      if (target.type !== 'service_worker' || !target.url.startsWith('chrome-extension://')) {
        continue;
      }
      if (!target.url.endsWith('/background.js')) continue;
      let sessionId = null;
      let matched = false;
      try {
        const attached = await cdp.send('Target.attachToTarget', {
          targetId: target.targetId,
          flatten: true,
        });
        sessionId = attached.sessionId;
        const result = await cdp.send(
          'Runtime.evaluate',
          {
            expression: 'chrome.runtime.getManifest().name',
            returnByValue: true,
          },
          sessionId
        );
        if (result.result && wanted.includes(result.result.value)) {
          matched = true;
          return { target, sessionId };
        }
      } catch (_) {
        /* 不是我们的扩展 */
      } finally {
        if (sessionId && !matched) {
          try {
            await cdp.send('Target.detachFromTarget', { sessionId });
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
    await sleep(300);
  }
  return null;
}
async function waitForEndpoint(deadlineMs) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return await response.json();
    } catch (_) {
      /* not ready */
    }
    await sleep(250);
  }
  throw new Error('Edge 调试端口没有启动');
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId
  );
  if (result.exceptionDetails) {
    throw new Error('页面执行出错：' + JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function waitForReady(cdp, sessionId) {
  for (let i = 0; i < 60; i++) {
    try {
      const state = await evaluate(cdp, sessionId, 'document.readyState');
      if (state === 'complete') return;
    } catch (_) {
      /* ignore */
    }
    await sleep(100);
  }
  throw new Error('页面加载超时');
}

async function findTarget(cdp, predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(predicate);
    if (target) return target;
    await sleep(250);
  }
  return null;
}

function killTree(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (_) {
    /* ignore */
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await rm(PROFILE, { recursive: true, force: true });

  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--lang=${LANG}`,
      `--user-data-dir=${PROFILE}`,
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1280,900',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let cdp = null;
  try {
    const version = await waitForEndpoint(15000);
    cdp = await CDP.connect(version.webSocketDebuggerUrl);

    const found = await findExtensionWorker(
      cdp,
      ['剪贴板键入助手', 'Clipboard Typing Assistant'],
      15000
    );
    if (!found) {
      const { targetInfos } = await cdp.send('Target.getTargets');
      console.error(
        '未找到扩展 SW，当前 targets:',
        targetInfos.map((t) => `${t.type} :: ${t.url}`)
      );
      throw new Error('扩展 Service Worker 没有启动');
    }
    const extensionId = new URL(found.target.url).host;
    console.log('扩展 ID:', extensionId);

    const swSession = found.sessionId;
    await cdp.send('Runtime.enable', {}, swSession);
    await sleep(500);
    await evaluate(
      cdp,
      swSession,
      `globalThis.__e2eKeepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 4000); 'ok'`
    );

    const uiLanguage = await evaluate(cdp, swSession, 'chrome.i18n.getUILanguage()');
    const menuTitle = await evaluate(
      cdp,
      swSession,
      `chrome.i18n.getMessage('menuTitle')`
    );
    const expectedMenuTitle = LANG.startsWith('zh')
      ? '从剪贴板输入（模拟键盘）'
      : 'Input from clipboard (simulated keyboard)';
    check(
      '界面语言与右键菜单标题已本地化',
      menuTitle === expectedMenuTitle,
      JSON.stringify({ uiLanguage, menuTitle, expectedMenuTitle })
    );

    const swErrors = [];
    cdp.on(swSession, 'Runtime.exceptionThrown', (params) => {
      swErrors.push(params.exceptionDetails.text || 'exception');
    });

    const pageTarget = await findTarget(cdp, (t) => t.type === 'page', 5000);
    if (!pageTarget) throw new Error('没有页面 target');
    const page = await cdp.send('Target.attachToTarget', {
      targetId: pageTarget.targetId,
      flatten: true,
    });
    const pageSession = page.sessionId;
    await cdp.send('Runtime.enable', {}, pageSession);
    await cdp.send('Page.enable', {}, pageSession);
    await cdp.send('Page.bringToFront', {}, pageSession);

    const pageErrors = [];
    cdp.on(pageSession, 'Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails.text || 'exception');
    });

    let menuState = '';
    for (let attempt = 0; attempt < 12; attempt++) {
      menuState = await evaluate(
        cdp,
        swSession,
        `new Promise((resolve) => {
          chrome.contextMenus.update('ct-paste-as-typing', {}, () => {
            resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok');
          });
        })`
      );
      if (menuState === 'ok') break;
      await sleep(250);
    }
    check('右键菜单已注册', menuState === 'ok', menuState);

    // 授予页面剪贴板权限，方便写入测试文本
    await cdp.send('Browser.grantPermissions', {
      origin: 'http://127.0.0.1:8123',
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });

    await cdp.send('Page.navigate', { url: TEST_URL }, pageSession);
    await waitForReady(cdp, pageSession);
    await sleep(300);

    const defaultText = '你好，世界！Hello 👨‍👩‍👧‍👦 123\n第二行 line 2\n第三行';
    const singleLine = defaultText.replace(/\n/g, ' ');

    // 让 textarea 获得焦点
    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('ta'); el.value=''; el.focus(); el.setSelectionRange(0,0); return document.hasFocus(); })()`
    );

    const sendInfo = await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        if (!tab) return { error: 'no tab', tabs: tabs.map(t => ({ id: t.id, url: t.url })) };
        const res = await chrome.tabs.sendMessage(
          tab.id,
          { type: 'CT_TYPE_CLIPBOARD', source: 'contextMenu', targetHint: 'editable', text: ${JSON.stringify(
            defaultText
          )} },
          { frameId: 0 }
        );
        return { tabId: tab.id, res };
      })()`
    );
    console.log('sendMessage 返回:', JSON.stringify(sendInfo));
    check('Service Worker 找到测试标签页', !!(sendInfo && sendInfo.tabId), JSON.stringify(sendInfo));

    let taValue = await evaluate(cdp, pageSession, `document.getElementById('ta').value`);
    check('textarea 逐字输入完整', taValue === defaultText, JSON.stringify(taValue));

    const toastText = await evaluate(
      cdp,
      pageSession,
      `(document.querySelector('ct-typing-toast')?.shadowRoot?.querySelector('.box')?.textContent) || ''`
    );
    const expectedToast = LANG.startsWith('zh')
      ? `已输入 ${defaultText.length} 个字符`
      : `Typed ${defaultText.length} character(s)`;
    check(
      '输入完成提示已本地化',
      toastText.includes(expectedToast),
      JSON.stringify({ toastText, expectedToast })
    );

    let pasteCount = await evaluate(
      cdp,
      pageSession,
      `document.querySelector('[data-case="textarea"] .paste-count').textContent`
    );
    check('textarea 没有触发 paste 事件', pasteCount === '0', 'paste 计数 = ' + pasteCount);

    let inputCount = await evaluate(
      cdp,
      pageSession,
      `document.querySelector('[data-case="textarea"] .input-count').textContent`
    );
    check('textarea 收到了 input 事件', Number(inputCount) > 0, 'input 计数 = ' + inputCount);

    // 单行 input：换行应变成空格
    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('inp'); el.value=''; el.focus(); return true; })()`
    );
    await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, { type: 'CT_TYPE_CLIPBOARD', source: 'contextMenu', targetHint: 'editable', text: ${JSON.stringify(
          defaultText
        )} }, { frameId: 0 });
      })()`
    );
    const inpValue = await evaluate(cdp, pageSession, `document.getElementById('inp').value`);
    check('单行 input 换行转空格', inpValue === singleLine, JSON.stringify(inpValue));

    // contenteditable
    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('ce'); el.textContent=''; el.focus(); return true; })()`
    );
    await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, { type: 'CT_TYPE_CLIPBOARD', source: 'contextMenu', targetHint: 'editable', text: ${JSON.stringify(
          defaultText
        )} }, { frameId: 0 });
      })()`
    );
    const ceText = await evaluate(cdp, pageSession, `document.getElementById('ce').innerText`);
    check(
      'contenteditable 输入完整',
      ceText.replace(/\r/g, '') === defaultText,
      JSON.stringify(ceText)
    );

    // Shadow DOM
    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('shadow-host').shadowRoot.getElementById('shadow-input'); el.value=''; el.focus(); return true; })()`
    );
    await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, { type: 'CT_TYPE_CLIPBOARD', source: 'contextMenu', targetHint: 'editable', text: ${JSON.stringify(
          defaultText
        )} }, { frameId: 0 });
      })()`
    );
    const shadowValue = await evaluate(
      cdp,
      pageSession,
      `document.getElementById('shadow-host').shadowRoot.getElementById('shadow-input').value`
    );
    check('Shadow DOM 输入框可输入', shadowValue === singleLine, JSON.stringify(shadowValue));

    // 剪贴板链路：页面写入剪贴板 -> 扩展读取
    const clipboardText = '剪贴板真实内容 🚀\nsecond line';
    await evaluate(
      cdp,
      pageSession,
      `(async () => { await navigator.clipboard.writeText(${JSON.stringify(
        clipboardText
      )}); return await navigator.clipboard.readText(); })()`
    );

    // Offscreen 读取在最后的 Popup -> Background 消息测试中覆盖

    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('ta'); el.value=''; el.focus(); return true; })()`
    );
    const readViaContent = await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, { type: 'CT_TYPE_CLIPBOARD', source: 'contextMenu', targetHint: 'editable' }, { frameId: 0 });
      })()`
    );
    const taValue2 = await evaluate(cdp, pageSession, `document.getElementById('ta').value`);
    check(
      'Content Script 读取剪贴板并输入',
      taValue2 === clipboardText,
      JSON.stringify({ res: readViaContent, value: taValue2 })
    );

    // 快捷键同款路径（source=shortcut）
    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('ta'); el.value=''; el.focus(); return document.hasFocus(); })()`
    );
    await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, { type: 'CT_TYPE_CLIPBOARD', source: 'shortcut', targetHint: 'focused', text: '快捷键路径 OK' }, { frameId: 0 });
      })()`
    );
    const taValue3 = await evaluate(cdp, pageSession, `document.getElementById('ta').value`);
    check('快捷键路径输入', taValue3 === '快捷键路径 OK', JSON.stringify(taValue3));

    // iframe：验证消息能到达子 frame，且只由持有焦点的 frame 输入
    const frameFocus = await evaluate(
      cdp,
      pageSession,
      `(() => {
        const el = document.getElementById('ta');
        el.value = 'PARENT-UNCHANGED';
        const doc = document.getElementById('frame').contentDocument;
        const child = doc.getElementById('ta-frame');
        child.value = '';
        child.focus();
        return { childFocus: doc.hasFocus(), parentFocus: document.hasFocus() };
      })()`
    );
    await sleep(120);
    await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, {
          type: 'CT_TYPE_CLIPBOARD',
          source: 'shortcut',
          targetHint: 'focused',
          text: 'iframe 内容 OK',
        });
      })()`
    );
    await sleep(400);
    const frameValue = await evaluate(
      cdp,
      pageSession,
      `document.getElementById('frame').contentDocument.getElementById('ta-frame').value`
    );
    const parentValue = await evaluate(cdp, pageSession, `document.getElementById('ta').value`);
    check(
      'iframe 内输入框可输入（焦点路由正确）',
      frameValue === 'iframe 内容 OK' && parentValue === 'PARENT-UNCHANGED',
      JSON.stringify({ frameFocus, frameValue, parentValue })
    );

    // 页面截图：最后再输入一段示例文字，让截图更直观
    console.log('… 页面截图');
    await evaluate(
      cdp,
      pageSession,
      `(() => { const el = document.getElementById('ta'); el.value = ''; el.focus(); return true; })()`
    );
    await evaluate(
      cdp,
      swSession,
      `(async () => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((t) => (t.url || '').includes('paste-blocked'));
        return chrome.tabs.sendMessage(tab.id, {
          type: 'CT_TYPE_CLIPBOARD',
          source: 'contextMenu',
          targetHint: 'editable',
          text: '这是通过扩展逐字输入的内容 ✅ Hello 123',
        }, { frameId: 0 });
      })()`
    );
    await evaluate(cdp, pageSession, `window.scrollTo(0, 0); true`);
    await sleep(2800);
    const shot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      pageSession
    );
    await writeFile(path.join(OUT, 'test-page.png'), Buffer.from(shot.data, 'base64'));

    // Popup 页面
    console.log('… 创建 Popup 页面');
    const popupTarget = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup.html`,
    });
    const popupAttach = await cdp.send('Target.attachToTarget', {
      targetId: popupTarget.targetId,
      flatten: true,
    });
    const popupSession = popupAttach.sessionId;
    await cdp.send('Runtime.enable', {}, popupSession);
    await cdp.send('Page.enable', {}, popupSession);
    console.log('… 等待 Popup 加载');
    await waitForReady(cdp, popupSession);
    await sleep(300);
    console.log('… Popup 已加载');
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: 360, height: 640, deviceScaleFactor: 2, mobile: false },
      popupSession
    );
    const popupShot = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true },
      popupSession
    );
    await writeFile(path.join(OUT, 'popup.png'), Buffer.from(popupShot.data, 'base64'));

    // Popup -> Background 的剪贴板消息通道
    const bgClipboard = await evaluate(
      cdp,
      popupSession,
      `chrome.runtime.sendMessage({ type: 'CT_GET_CLIPBOARD' }).then((r) => JSON.stringify(r))`
    );
    check(
      'Background 剪贴板消息通道可用',
      JSON.parse(bgClipboard).ok === true,
      bgClipboard
    );

    const commandInfo = await evaluate(
      cdp,
      popupSession,
      `chrome.commands.getAll().then((commands) => JSON.stringify(commands))`
    );
    const command = JSON.parse(commandInfo).find((item) => item.name === 'paste-as-typing');
    check(
      '快捷键已注册',
      !!command && !!command.shortcut,
      commandInfo
    );

    check('Service Worker 没有异常', swErrors.length === 0, JSON.stringify(swErrors));
    check('页面没有异常', pageErrors.length === 0, JSON.stringify(pageErrors));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
    if (failed.length) process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    killTree(edge.pid);
    await sleep(300);
    try {
      await rm(PROFILE, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  }
}

main().catch((error) => {
  console.error('测试失败：', error);
  process.exitCode = 1;
});




