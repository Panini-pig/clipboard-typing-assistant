'use strict';

const DEFAULTS = { inputMode: 'char', delayMs: 0 };

const VERSION_EL = document.getElementById('version');
const SHORTCUT_EL = document.getElementById('shortcut');
const MODE_DESC = document.getElementById('modeDesc');
const DELAY_SELECT = document.getElementById('delay');
const MODE_RADIOS = Array.from(document.querySelectorAll('input[name="inputMode"]'));

const MODE_DESCRIPTIONS = {
  char: '逐字触发输入事件，最接近真人打字，兼容性最好。',
  instant: '一次性写入整段文本，速度最快；个别编辑器可能只收到一次输入事件。',
};

function currentMode() {
  const checked = MODE_RADIOS.find((radio) => radio.checked);
  return checked ? checked.value : DEFAULTS.inputMode;
}

function updateModeUi() {
  const mode = currentMode();
  MODE_DESC.textContent = MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.char;
  DELAY_SELECT.disabled = mode === 'instant';
  DELAY_SELECT.title = mode === 'instant' ? '整段输入模式下不使用输入间隔' : '';
}

async function saveSettings() {
  const mode = currentMode();
  const delayMs = Number(DELAY_SELECT.value) || 0;
  try {
    await chrome.storage.sync.set({ inputMode: mode, delayMs });
  } catch (_) {
    /* 存储失败时保留界面状态即可 */
  }
}

function formatShortcut(shortcut) {
  if (!shortcut) return '未设置';
  return shortcut
    .replace(/Command/g, '⌘')
    .replace(/MacCtrl/g, '⌃')
    .replace(/Alt/g, 'Alt')
    .replace(/Shift/g, 'Shift')
    .replace(/Ctrl/g, 'Ctrl')
    .split('+')
    .join(' + ');
}

async function loadShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const command = commands.find((item) => item.name === 'paste-as-typing');
    SHORTCUT_EL.textContent = formatShortcut(command && command.shortcut);
  } catch (_) {
    SHORTCUT_EL.textContent = 'Alt + Shift + V';
  }
}

async function init() {
  try {
    VERSION_EL.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch (_) {
    VERSION_EL.textContent = '';
  }

  let values = { ...DEFAULTS };
  try {
    values = Object.assign({}, DEFAULTS, await chrome.storage.sync.get(DEFAULTS));
  } catch (_) {
    /* ignore */
  }

  for (const radio of MODE_RADIOS) {
    radio.checked = radio.value === values.inputMode;
    radio.addEventListener('change', () => {
      updateModeUi();
      saveSettings();
    });
  }

  const delayValue = String(values.delayMs);
  if (Array.from(DELAY_SELECT.options).some((option) => option.value === delayValue)) {
    DELAY_SELECT.value = delayValue;
  } else {
    DELAY_SELECT.value = String(DEFAULTS.delayMs);
  }

  DELAY_SELECT.addEventListener('change', saveSettings);

  updateModeUi();
  loadShortcut();
}

document.addEventListener('DOMContentLoaded', init);
