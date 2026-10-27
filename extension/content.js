/* 剪贴板键入助手 - Content Script
 *
 * 思路：
 *  - 不触发 paste 事件，因此网站基于 paste 的拦截全部失效；
 *  - 使用 document.execCommand('insertText') 逐字/分批写入，
 *    浏览器会像真实键盘输入一样派发 beforeinput / input 事件；
 *  - execCommand 不可用时，退回原生 value setter + input 事件，
 *    兼容 React / Vue 等受控组件。
 */
(() => {
  'use strict';

  // 扩展更新/重载后，旧脚本的 chrome.runtime 会失效，此时允许重新注入
  function extensionAlive() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function t(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch (_) {
      return key;
    }
  }

  if (globalThis.__ctTypingAssistantInstalled && extensionAlive()) return;
  globalThis.__ctTypingAssistantInstalled = true;

  const DEFAULT_SETTINGS = { inputMode: 'char', delayMs: 0 };
  const MAX_TEXT_LENGTH = 200000;
  const LONG_TEXT_THRESHOLD = 3000;
  const LONG_TEXT_CHUNK = 80;
  const TEXT_INPUT_TYPES = new Set([
    'text',
    'search',
    'url',
    'tel',
    'email',
    'password',
    'number',
    '',
  ]);

  let settings = { ...DEFAULT_SETTINGS };
  let lastEditable = null;
  let lastPointer = null;
  let typingState = null;
  let toastTimer = 0;
  let toastHost = null;
  let toastBox = null;

  /* ------------------------------------------------------------------ */
  /* 设置                                                                */
  /* ------------------------------------------------------------------ */

  function loadSettings() {
    try {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (values) => {
        if (chrome.runtime.lastError) return;
        settings = Object.assign({}, DEFAULT_SETTINGS, values || {});
      });
    } catch (_) {
      /* 扩展上下文失效时忽略 */
    }
  }

  loadSettings();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (changes[key]) {
          settings[key] = changes[key].newValue;
        }
      }
    });
  } catch (_) {
    /* ignore */
  }

  /* ------------------------------------------------------------------ */
  /* 焦点 / 指针跟踪                                                      */
  /* ------------------------------------------------------------------ */

  document.addEventListener(
    'focusin',
    (event) => {
      const editable = editingHostOf(eventTarget(event));
      if (editable && isWritable(editable)) {
        lastEditable = editable;
      }
    },
    true
  );

  function recordPointer(event) {
    if (event.type === 'contextmenu' || event.button === 2) {
      lastPointer = {
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
      };
    }
  }

  document.addEventListener('mousedown', recordPointer, true);
  document.addEventListener('contextmenu', recordPointer, true);

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && typingState) {
        typingState.cancelled = true;
      }
    },
    true
  );

  /* ------------------------------------------------------------------ */
  /* 消息                                                                */
  /* ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !sender || sender.id !== chrome.runtime.id) return;
    if (message.type !== 'CT_TYPE_CLIPBOARD') return;

    typeClipboard(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        console.warn('[Clipboard Typing] Input failed:', error);
        showToast(
          t('typeFailed', [String((error && error.message) || error)]),
          'error',
          3200
        );
        sendResponse({ ok: false, reason: 'error' });
      });

    return true;
  });

  /* ------------------------------------------------------------------ */
  /* 主流程                                                              */
  /* ------------------------------------------------------------------ */

  async function typeClipboard(message) {
    if (typingState) {
      showToast(t('busy'), 'warn', 1200);
      return { ok: false, reason: 'busy' };
    }

    if (message.source === 'shortcut' && !document.hasFocus()) {
      return { ok: false, reason: 'not-focused', silent: true };
    }

    const target = resolveTarget(message);
    if (!target) {
      if (shouldShowNoTargetToast(message)) {
        showToast(
          message.source === 'shortcut'
            ? t('noTargetShortcut')
            : t('noTargetMenu'),
          'error'
        );
      }
      return { ok: false, reason: 'no-target' };
    }

    let text;
    if (typeof message.text === 'string') {
      text = message.text;
    } else {
      const clip = await readClipboardText();
      if (!clip.ok) {
        showToast(t('clipboardReadFailed'), 'error', 3200);
        return { ok: false, reason: 'clipboard-unavailable' };
      }
      text = clip.text;
    }

    text = String(text || '').replace(/\r\n?/g, '\n');
    if (!text) {
      showToast(t('clipboardEmpty'), 'warn');
      return { ok: false, reason: 'empty' };
    }

    let truncated = false;
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.slice(0, MAX_TEXT_LENGTH);
      truncated = true;
    }

    await waitForFocus(300);

    const el = prepareTarget(target);
    if (!el) {
      showToast(t('targetNotEditable'), 'error');
      return { ok: false, reason: 'not-writable' };
    }

    const state = {
      cancelled: false,
      failed: false,
      lengthLimited: false,
      inserted: 0,
    };

    typingState = state;
    showToast(t('typingStarted'), 'info', 1200);

    try {
      if (isTextControl(el)) {
        await typeIntoTextControl(el, text, state);
      } else if (isContentEditableTarget(el)) {
        await typeIntoContentEditable(el, text, state);
      } else {
        showToast(t('unsupported'), 'error');
        return { ok: false, reason: 'unsupported' };
      }
    } finally {
      typingState = null;
    }

    if (state.cancelled) {
      showToast(t('stopped'), 'warn', 1600);
      return { ok: false, reason: 'cancelled' };
    }

    if (state.failed) {
      showToast(t('rejected'), 'error', 3200);
      return { ok: false, reason: 'failed' };
    }

    const limited = truncated || state.lengthLimited;
    showToast(
      t(limited ? 'typedCountTruncated' : 'typedCount', [
        String(state.inserted),
      ]),
      'success',
      2200
    );

    return { ok: true, inserted: state.inserted };
  }

  function shouldShowNoTargetToast(message) {
    if (message.source !== 'shortcut') return true;
    if (window.top !== window) return false;
    // 焦点可能在上面的 iframe 里，此时由子 frame 处理，父页面不要误报
    const active = document.activeElement;
    if (active && active.tagName === 'IFRAME') return false;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 目标定位                                                            */
  /* ------------------------------------------------------------------ */

  function resolveTarget(message) {
    const active = getDeepActiveElement();
    if (isWritable(active)) return editingHostOf(active);

    if (message.targetHint === 'focused') return null;

    if (isWritable(lastEditable)) return lastEditable;

    if (lastPointer && Date.now() - lastPointer.time < 120000) {
      const hit = document.elementFromPoint(lastPointer.x, lastPointer.y);
      const editable = editingHostOf(closestEditable(hit));
      if (isWritable(editable)) return editable;
    }

    return findBestEditable();
  }

  function getDeepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function eventTarget(event) {
    if (typeof event.composedPath === 'function') {
      const path = event.composedPath();
      if (path && path.length) return path[0];
    }
    return event.target;
  }

  function isTextControl(el) {
    return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
  }

  function isContentEditableTarget(el) {
    return (
      !!el &&
      (el.isContentEditable || (document.designMode === 'on' && el === document.body))
    );
  }

  function isEditable(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.isContentEditable) return true;

    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      return TEXT_INPUT_TYPES.has(type);
    }
    if (document.designMode === 'on' && el === document.body) return true;
    return false;
  }

  function editingHostOf(el) {
    if (!el || !isEditable(el)) return null;
    if (el.isContentEditable) {
      let node = el;
      while (node.parentElement && node.parentElement.isContentEditable) {
        node = node.parentElement;
      }
      return node;
    }
    return el;
  }

  function isWritable(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;
    if (!isEditable(el)) return false;
    if (el.disabled) return false;
    if (el.readOnly) return false;
    if (el.tagName === 'INPUT' && el.type === 'hidden') return false;

    try {
      const style = window.getComputedStyle(el);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch (_) {
      return false;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;

    return true;
  }

  function closestEditable(node) {
    let el = node instanceof Element ? node : node && node.parentElement;
    while (el) {
      if (isEditable(el)) return el;
      if (el.parentElement) {
        el = el.parentElement;
        continue;
      }
      const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
      el = root && root.host ? root.host : null;
    }
    return null;
  }

  function findBestEditable() {
    const nodes = document.querySelectorAll(
      'textarea, input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
    );
    let best = null;
    let bestScore = 0;

    for (const node of nodes) {
      if (!isWritable(node)) continue;
      if (node.tagName === 'INPUT') {
        const type = (node.getAttribute('type') || 'text').toLowerCase();
        if (!TEXT_INPUT_TYPES.has(type)) continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 10) continue;
      if (
        rect.bottom < 0 ||
        rect.right < 0 ||
        rect.top > window.innerHeight ||
        rect.left > window.innerWidth
      ) {
        continue;
      }
      const score = rect.width * rect.height;
      if (score > bestScore) {
        bestScore = score;
        best = editingHostOf(node);
      }
    }

    return best;
  }

  function prepareTarget(target) {
    const el = editingHostOf(target);
    if (!isWritable(el)) return null;

    const snapshot = captureSelection(el);

    if (getDeepActiveElement() !== el) {
      try {
        el.focus({ preventScroll: true });
      } catch (_) {
        try {
          el.focus();
        } catch (__) {
          return null;
        }
      }
    }

    restoreSelection(el, snapshot);

    if (isContentEditableTarget(el) && !selectionInside(el)) {
      placeCaretAtEnd(el);
    }

    return el;
  }

  function isStillTarget(el) {
    if (!el || !el.isConnected) return false;
    const active = getDeepActiveElement();
    return active === el || el.contains(active);
  }

  async function waitForFocus(timeout) {
    const start = Date.now();
    while (!document.hasFocus() && Date.now() - start < timeout) {
      await delay(25);
    }
    if (!document.hasFocus()) {
      try {
        window.focus();
      } catch (_) {
        /* ignore */
      }
      await delay(30);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 选区保存 / 恢复                                                      */
  /* ------------------------------------------------------------------ */

  function captureSelection(el) {
    if (!el || !(el instanceof Element)) return null;

    if (isTextControl(el)) {
      try {
        return {
          start: el.selectionStart,
          end: el.selectionEnd,
          direction: el.selectionDirection,
        };
      } catch (_) {
        return null;
      }
    }

    if (el.isContentEditable) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        try {
          if (el.contains(range.startContainer) && el.contains(range.endContainer)) {
            return { range: range.cloneRange() };
          }
        } catch (_) {
          /* ignore */
        }
      }
    }

    return null;
  }

  function restoreSelection(el, snapshot) {
    if (!snapshot) return;

    if (snapshot.range) {
      const selection = window.getSelection();
      if (selection) {
        try {
          selection.removeAllRanges();
          selection.addRange(snapshot.range);
        } catch (_) {
          /* ignore */
        }
      }
      return;
    }

    if (typeof snapshot.start === 'number') {
      try {
        el.setSelectionRange(snapshot.start, snapshot.end, snapshot.direction || 'none');
      } catch (_) {
        /* number / email 等类型不支持 setSelectionRange */
      }
    }
  }

  function selectionInside(el) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    try {
      return (
        el.contains(selection.anchorNode) &&
        el.contains(selection.focusNode)
      );
    } catch (_) {
      return false;
    }
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 剪贴板读取                                                          */
  /* ------------------------------------------------------------------ */

  async function readClipboardText() {
    const viaApi = await readClipboardWithApi();
    if (viaApi !== null) return { ok: true, text: viaApi };

    const viaBackground = await readClipboardWithBackground();
    if (viaBackground !== null) return { ok: true, text: viaBackground };

    const viaLegacy = readClipboardWithExecCommand();
    if (viaLegacy !== null) return { ok: true, text: viaLegacy };

    return { ok: false };
  }

  async function readClipboardWithApi() {
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
        return null;
      }
      const text = await withTimeout(navigator.clipboard.readText(), 1500);
      return typeof text === 'string' ? text : null;
    } catch (_) {
      return null;
    }
  }

  async function readClipboardWithBackground() {
    try {
      const response = await withTimeout(
        chrome.runtime.sendMessage({ type: 'CT_GET_CLIPBOARD' }),
        5000
      );
      if (response && response.ok && typeof response.text === 'string') {
        return response.text;
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  function readClipboardWithExecCommand() {
    const mount = document.body || document.documentElement;
    if (!mount) return null;

    const previous = getDeepActiveElement();
    const previousSelection = captureSelection(previous);

    const helper = document.createElement('textarea');
    helper.setAttribute('aria-hidden', 'true');
    helper.value = '';
    helper.style.cssText =
      'position:fixed !important;left:-10000px !important;top:0 !important;' +
      'width:1px !important;height:1px !important;opacity:0 !important;';
    mount.appendChild(helper);

    let ok = false;
    try {
      helper.focus({ preventScroll: true });
      ok = document.execCommand('paste');
    } catch (_) {
      ok = false;
    }

    const text = helper.value;
    helper.remove();

    if (previous && previous.isConnected && typeof previous.focus === 'function') {
      try {
        previous.focus({ preventScroll: true });
      } catch (_) {
        /* ignore */
      }
      restoreSelection(previous, previousSelection);
    }

    return ok ? text : null;
  }

  /* ------------------------------------------------------------------ */
  /* 输入核心                                                            */
  /* ------------------------------------------------------------------ */

  async function typeIntoTextControl(el, text, state) {
    const graphemes = splitGraphemes(text);
    const mode = settings.inputMode === 'instant' ? 'instant' : 'char';
    const pieces = buildPieces(graphemes, mode);
    const multiline = el.tagName === 'TEXTAREA';

    if (pieces.length > 1 && graphemes.length > LONG_TEXT_THRESHOLD) {
      showToast(t('longTextBatching'), 'info', 1500);
    }

    for (let index = 0; index < pieces.length; index++) {
      if (state.cancelled) return;
      if (!isStillTarget(el)) {
        state.cancelled = true;
        return;
      }

      let piece = pieces[index];
      if (!multiline) {
        piece = piece.replace(/\n/g, ' ');
      }
      if (!piece) continue;

      if (!insertIntoTextControl(el, piece, state)) return;

      if (
        el.maxLength >= 0 &&
        el.value.length >= el.maxLength &&
        index < pieces.length - 1
      ) {
        state.lengthLimited = true;
        return;
      }

      if (settings.delayMs > 0 && index < pieces.length - 1) {
        await delay(settings.delayMs);
      } else if (index % 40 === 0) {
        await nextTick();
      }
    }
  }

  async function typeIntoContentEditable(el, text, state) {
    const lines = text.split('\n');
    const mode = settings.inputMode === 'instant' ? 'instant' : 'char';

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      if (state.cancelled) return;
      if (!isStillTarget(el)) {
        state.cancelled = true;
        return;
      }

      const line = lines[lineIndex];
      if (line) {
        const pieces = buildPieces(splitGraphemes(line), mode);
        for (let index = 0; index < pieces.length; index++) {
          if (state.cancelled) return;
          if (!isStillTarget(el)) {
            state.cancelled = true;
            return;
          }

          const piece = pieces[index];
          if (!piece) continue;

          if (!insertIntoContentEditable(el, piece, state)) return;

          if (settings.delayMs > 0) {
            await delay(settings.delayMs);
          } else if (index % 40 === 0) {
            await nextTick();
          }
        }
      }

      if (lineIndex < lines.length - 1) {
        if (!insertLineBreakIntoContentEditable(el, state)) return;
        if (settings.delayMs > 0) await delay(settings.delayMs);
      }
    }
  }

  function insertIntoTextControl(el, piece, state) {
    const before = el.value;
    let ok = false;

    try {
      ok = document.execCommand('insertText', false, piece);
    } catch (_) {
      ok = false;
    }

    if (!ok || el.value === before) {
      // execCommand 被拒绝或没有生效时，走原生 setter（兼容受控组件）
      if (!setValueLikeTyping(el, piece)) {
        state.failed = true;
        return false;
      }
    }

    state.inserted += piece.length;
    return true;
  }

  function setValueLikeTyping(el, text) {
    let start = null;
    let end = null;

    try {
      start = el.selectionStart;
      end = el.selectionEnd;
    } catch (_) {
      start = null;
    }

    const current = el.value;
    if (start === null || end === null) {
      start = current.length;
      end = current.length;
    }

    let next = current.slice(0, start) + text + current.slice(end);
    if (el.maxLength >= 0) {
      next = next.slice(0, el.maxLength);
    }

    if (next !== current) {
      setNativeValue(el, next);
      try {
        const caret = Math.min(start + text.length, next.length);
        el.setSelectionRange(caret, caret);
      } catch (_) {
        /* ignore */
      }
      dispatchInput(el, text);
    }

    return true;
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function insertIntoContentEditable(el, piece, state) {
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, piece);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      ok = fallbackInsertIntoContentEditable(el, piece);
      if (!ok) {
        state.failed = true;
        return false;
      }
    }

    state.inserted += piece.length;
    return true;
  }

  function insertLineBreakIntoContentEditable(el, state) {
    let ok = false;
    try {
      ok = document.execCommand('insertLineBreak');
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      ok = fallbackInsertIntoContentEditable(el, '\n');
      if (!ok) {
        state.failed = true;
        return false;
      }
    }

    state.inserted += 1;
    return true;
  }

  function fallbackInsertIntoContentEditable(el, text) {
    const selection = window.getSelection();
    if (!selection) return false;

    let range = null;
    if (selection.rangeCount > 0) {
      const candidate = selection.getRangeAt(0);
      try {
        if (
          el.contains(candidate.startContainer) &&
          el.contains(candidate.endContainer)
        ) {
          range = candidate;
        }
      } catch (_) {
        range = null;
      }
    }

    if (!range) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }

    range.deleteContents();

    const fragment = document.createDocumentFragment();
    const parts = text.split('\n');
    parts.forEach((part, index) => {
      if (part) fragment.appendChild(document.createTextNode(part));
      if (index < parts.length - 1) fragment.appendChild(document.createElement('br'));
    });

    const last = fragment.lastChild;
    if (!last) return true;

    range.insertNode(fragment);
    range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    dispatchInput(el, text);
    return true;
  }

  function dispatchInput(el, data) {
    let event;
    try {
      event = new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data,
      });
    } catch (_) {
      event = new Event('input', { bubbles: true, composed: true });
    }
    el.dispatchEvent(event);
  }

  /* ------------------------------------------------------------------ */
  /* 文本切分                                                            */
  /* ------------------------------------------------------------------ */

  const segmenter = (() => {
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
        return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  })();

  function splitGraphemes(text) {
    if (segmenter) {
      return Array.from(segmenter.segment(text), (item) => item.segment);
    }
    return Array.from(text);
  }

  function buildPieces(graphemes, mode) {
    if (mode === 'instant') {
      return [graphemes.join('')];
    }
    if (graphemes.length > LONG_TEXT_THRESHOLD) {
      const chunks = [];
      for (let index = 0; index < graphemes.length; index += LONG_TEXT_CHUNK) {
        chunks.push(graphemes.slice(index, index + LONG_TEXT_CHUNK).join(''));
      }
      return chunks;
    }
    return graphemes;
  }

  /* ------------------------------------------------------------------ */
  /* 提示条                                                              */
  /* ------------------------------------------------------------------ */

  const TOAST_STYLE = `
    :host { all: initial; }
    .box {
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      line-height: 1.55;
      color: #ffffff;
      background: rgba(17, 24, 39, 0.94);
      border-radius: 10px;
      padding: 9px 14px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      max-width: min(560px, 78vw);
      white-space: pre-wrap;
      word-break: break-word;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 160ms ease, transform 160ms ease;
      pointer-events: none;
    }
    .box.show { opacity: 1; transform: translateY(0); }
    .box.success { background: rgba(4, 108, 78, 0.95); }
    .box.error { background: rgba(180, 35, 24, 0.95); }
    .box.warn { background: rgba(181, 71, 8, 0.95); }
  `;

  function ensureToast() {
    if (toastHost && toastHost.isConnected && toastBox) return;

    const root = document.body || document.documentElement;
    if (!root) return;

    toastHost = document.createElement('ct-typing-toast');
    toastHost.style.cssText =
      'all: initial !important;' +
      'position: fixed !important;' +
      'left: 0 !important;' +
      'right: 0 !important;' +
      'bottom: 24px !important;' +
      'display: flex !important;' +
      'justify-content: center !important;' +
      'z-index: 2147483647 !important;' +
      'pointer-events: none !important;';

    const shadow = toastHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = TOAST_STYLE;
    shadow.appendChild(style);

    toastBox = document.createElement('div');
    toastBox.className = 'box';
    shadow.appendChild(toastBox);
    root.appendChild(toastHost);
  }

  function showToast(message, kind, duration) {
    try {
      ensureToast();
      if (!toastBox) return;

      toastBox.textContent = message;
      toastBox.className = 'box show ' + (kind || 'info');

      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toastBox) {
          toastBox.className = 'box ' + (kind || 'info');
        }
      }, typeof duration === 'number' ? duration : 2400);
    } catch (_) {
      /* 提示条失败不影响输入 */
    }
  }

  /* ------------------------------------------------------------------ */
  /* 小工具                                                              */
  /* ------------------------------------------------------------------ */

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function nextTick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t('timeout', [String(ms)]))),
        ms
      );
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
})();
