/* 剪贴板键入助手 - Offscreen Document
 *
 * Service Worker 里没有 DOM / navigator.clipboard，
 * 这里用一个不可见的扩展页面读取剪贴板文本。
 */
'use strict';

const TARGET = 'ct-offscreen';
let busy = false;

async function readClipboard() {
  const viaAsync = await readWithAsyncApi();
  if (viaAsync !== null) {
    return { ok: true, text: viaAsync };
  }

  const viaCommand = readWithExecCommand();
  if (viaCommand !== null) {
    return { ok: true, text: viaCommand };
  }

  return { ok: false, error: '无法读取剪贴板' };
}

async function readWithAsyncApi() {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      return null;
    }
    const text = await Promise.race([
      navigator.clipboard.readText(),
      new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
    ]);
    return typeof text === 'string' ? text : null;
  } catch (_) {
    return null;
  }
}

function readWithExecCommand() {
  const helper = document.getElementById('clipboard-target');
  if (!helper) return null;

  helper.value = '';
  try {
    helper.focus();
  } catch (_) {
    /* ignore */
  }

  let ok = false;
  try {
    ok = document.execCommand('paste');
  } catch (_) {
    ok = false;
  }

  return ok ? helper.value : null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== TARGET || message.type !== 'READ_CLIPBOARD') {
    return;
  }

  if (busy) {
    sendResponse({ ok: false, error: 'busy' });
    return;
  }

  busy = true;
  readClipboard()
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: String((error && error.message) || error),
      })
    )
    .finally(() => {
      busy = false;
    });

  return true;
});
