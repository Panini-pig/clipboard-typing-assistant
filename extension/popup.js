'use strict';

const DEFAULTS = { inputMode: 'char', delayMs: 0 };

const VERSION_EL = document.getElementById('version');
const SHORTCUT_EL = document.getElementById('shortcut');
const MODE_DESC = document.getElementById('modeDesc');
const DELAY_SELECT = document.getElementById('delay');
const MODE_RADIOS = Array.from(document.querySelectorAll('input[name="inputMode"]'));

const MODE_DESCRIPTION_KEYS = {
  char: 'modeDescChar',
  instant: 'modeDescInstant',
};

function t(key, substitutions) {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch (_) {
    return key;
  }
}

function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  }

  document.title = t('popupTitle');
  try {
    const uiLanguage = chrome.i18n.getUILanguage();
    document.documentElement.lang = uiLanguage.replace(/_/g, '-');
  } catch (_) {
    /* keep the markup language */
  }
}

function currentMode() {
  const checked = MODE_RADIOS.find((radio) => radio.checked);
  return checked ? checked.value : DEFAULTS.inputMode;
}

function updateModeUi() {
  const mode = currentMode();
  MODE_DESC.textContent = t(MODE_DESCRIPTION_KEYS[mode] || MODE_DESCRIPTION_KEYS.char);
  DELAY_SELECT.disabled = mode === 'instant';
  DELAY_SELECT.title = mode === 'instant' ? t('delayDisabledTitle') : '';
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
  if (!shortcut) return t('shortcutUnset');
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
  applyI18n();

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
