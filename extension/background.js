/* 剪贴板键入助手 - Service Worker */
'use strict';

const MENU_ID = 'ct-paste-as-typing';
const MENU_TITLE =
  chrome.i18n.getMessage('menuTitle') || '从剪贴板输入（模拟键盘）';
const OFFSCREEN_URL = 'offscreen.html';
const OFFSCREEN_TARGET = 'ct-offscreen';
const CONTENT_SCRIPT = 'content.js';

/* ------------------------------------------------------------------ */
/* 右键菜单                                                            */
/* ------------------------------------------------------------------ */

function createMenu() {
  try {
    chrome.contextMenus.create(
      {
        id: MENU_ID,
        title: MENU_TITLE,
        contexts: ['editable'],
      },
      () => {
        // 菜单已存在时会报 duplicate id，忽略即可
        void chrome.runtime.lastError;
      }
    );
  } catch (error) {
    // 某些 Edge 版本不支持菜单的扩展属性；创建基础菜单失败时也不应
    // 中断 Service Worker 后续初始化（消息、快捷键等）。
    console.warn('[Clipboard Typing] Failed to create the context menu:', error);
  }
}

function installMenus() {
  chrome.contextMenus.removeAll(() => {
    createMenu();
  });
}

// Service Worker 每次启动时兜底创建（菜单本身会跨重启保留）
createMenu();
chrome.runtime.onInstalled.addListener(installMenus);
chrome.runtime.onStartup.addListener(installMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab || typeof tab.id !== 'number') return;
  handleMenuClick(tab, info.frameId ?? 0).catch((error) => {
    console.warn('[Clipboard Typing] Context menu handler failed:', error);
    flashBadge();
  });
});

async function handleMenuClick(tab, frameId) {
  const message = {
    type: 'CT_TYPE_CLIPBOARD',
    source: 'contextMenu',
    targetHint: 'editable',
  };

  try {
    await sendMessageToFrame(tab.id, frameId, message);
  } catch (error) {
    // 受限页面（edge://、扩展商店等）无法注入，给个角标提示
    console.warn('[Clipboard Typing] Cannot run on this page:', error);
    flashBadge();
  }
}

/* ------------------------------------------------------------------ */
/* 快捷键                                                              */
/* ------------------------------------------------------------------ */

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'paste-as-typing') return;
  triggerShortcut().catch((error) => {
    console.warn('[Clipboard Typing] Shortcut handler failed:', error);
  });
});

async function triggerShortcut() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || typeof tab.id !== 'number') return;

  const message = {
    type: 'CT_TYPE_CLIPBOARD',
    source: 'shortcut',
    targetHint: 'focused',
  };

  try {
    // 不带 frameId 时，标签页内所有 frame 都会收到消息；
    // 只有真正持有焦点的那个 frame 会执行输入。
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: [CONTENT_SCRIPT],
      });
      await delay(80);
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (injectError) {
      console.warn('[Clipboard Typing] Shortcut cannot run on this page:', injectError);
      flashBadge();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 消息转发                                                            */
/* ------------------------------------------------------------------ */

async function sendMessageToFrame(tabId, frameId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch (error) {
    // 页面可能在扩展安装/更新前就已打开，动态补注入一次
    await injectContentScript(tabId, frameId);
    await delay(80);
    return chrome.tabs.sendMessage(tabId, message, { frameId });
  }
}

async function injectContentScript(tabId, frameId) {
  const target = frameId > 0 ? { tabId, frameIds: [frameId] } : { tabId };
  await chrome.scripting.executeScript({
    target,
    files: [CONTENT_SCRIPT],
  });
}

/* ------------------------------------------------------------------ */
/* 剪贴板读取（content script 失败时的兜底）                            */
/* ------------------------------------------------------------------ */

let offscreenQueue = Promise.resolve();

function withOffscreenLock(task) {
  const run = offscreenQueue.then(task, task);
  offscreenQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['CLIPBOARD'],
      justification:
        chrome.i18n.getMessage('offscreenJustification') ||
        'Read clipboard text to type it into a web form field',
    });
  } catch (error) {
    // 并发创建时可能已被另一个调用创建
    if (!String(error && error.message).includes('offscreen')) throw error;
  }
}

async function readClipboardViaOffscreen() {
  return withOffscreenLock(async () => {
    await ensureOffscreenDocument();
    const response = await withTimeout(
      chrome.runtime.sendMessage({
        target: OFFSCREEN_TARGET,
        type: 'READ_CLIPBOARD',
      }),
      4000
    );
    if (response && response.ok) return response.text;
    throw new Error((response && response.error) || '读取剪贴板失败');
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender || sender.id !== chrome.runtime.id) return;
  if (message.type === 'CT_GET_CLIPBOARD') {
    readClipboardViaOffscreen()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: String((error && error.message) || error),
        })
      );
    return true;
  }
});

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

let badgeTimer = null;

function flashBadge() {
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#B42318' });
    chrome.action.setBadgeText({ text: '!' });
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => {
      try {
        chrome.action.setBadgeText({ text: '' });
      } catch (_) {
        /* ignore */
      }
    }, 2500);
  } catch (_) {
    /* ignore */
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`操作超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
