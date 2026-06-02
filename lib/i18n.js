/**
 * Runtime i18n（自管,不走 chrome.i18n.getMessage）。
 *
 * 為什麼自管：chrome.i18n.getMessage 只能依瀏覽器 UI 語言,使用者無法
 * 從擴充功能內部切換。這個檔負責從 chrome.storage.local 讀使用者偏好,
 * fetch 對應的 _locales/<locale>/messages.json,再提供 t() / applyI18n()。
 *
 * 使用方式：
 *   import { initI18n, applyI18n, t } from "../lib/i18n.js";
 *   await initI18n();   // 必呼叫一次,否則 t() 會回 key 名
 *   applyI18n();        // 套用到當前 document
 *   t("someKey", arg1, arg2)
 *
 * 不適用於 content script（content script 不支援 ES module；
 * 文字由 background 預先格式化後夾在訊息 payload 中送過去）。
 */

export const SUPPORTED_LOCALES = ["zh_TW", "en"];
export const DEFAULT_LOCALE = "zh_TW";
export const LOCALE_STORAGE_KEY = "ui_locale";

let currentLocale = DEFAULT_LOCALE;
let messages = {};

async function loadMessages(locale) {
  const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status}`);
  return resp.json();
}

export async function getPreferredLocale() {
  try {
    const obj = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
    const v = obj[LOCALE_STORAGE_KEY];
    if (typeof v === "string" && SUPPORTED_LOCALES.includes(v)) return v;
  } catch (err) {
    console.warn("[BRO i18n] read preferred locale failed:", err);
  }
  return DEFAULT_LOCALE;
}

export async function setPreferredLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return false;
  try {
    await chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: locale });
    return true;
  } catch (err) {
    console.warn("[BRO i18n] write preferred locale failed:", err);
    return false;
  }
}

export async function initI18n() {
  currentLocale = await getPreferredLocale();
  try {
    messages = await loadMessages(currentLocale);
  } catch (err) {
    console.warn(`[BRO i18n] load ${currentLocale} failed:`, err);
    if (currentLocale !== DEFAULT_LOCALE) {
      try {
        messages = await loadMessages(DEFAULT_LOCALE);
        currentLocale = DEFAULT_LOCALE;
      } catch (err2) {
        console.error("[BRO i18n] default-locale load also failed:", err2);
        messages = {};
      }
    } else {
      messages = {};
    }
  }
  return currentLocale;
}

export function getCurrentLocale() {
  return currentLocale;
}

export function t(key, ...subs) {
  const entry = messages[key];
  if (!entry || typeof entry.message !== "string") return key;
  let msg = entry.message;
  if (subs.length > 0) {
    msg = msg.replace(/\$([1-9])/g, (_, n) => {
      const idx = parseInt(n, 10) - 1;
      return idx < subs.length ? String(subs[idx]) : `$${n}`;
    });
  }
  return msg;
}

const ATTR_BINDINGS = [
  ["data-i18n", (el, msg) => { el.textContent = msg; }],
  ["data-i18n-placeholder", (el, msg) => { el.placeholder = msg; }],
  ["data-i18n-title", (el, msg) => { el.title = msg; }],
  ["data-i18n-aria-label", (el, msg) => { el.setAttribute("aria-label", msg); }],
];

export function applyI18n(root = document) {
  if (root === document && document.documentElement) {
    document.documentElement.lang = currentLocale === "zh_TW" ? "zh-Hant" : "en";
  }
  for (const [attr, apply] of ATTR_BINDINGS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const key = el.getAttribute(attr);
      const msg = t(key);
      if (msg) apply(el, msg);
    }
  }
  const docTitleEl = root.querySelector("[data-i18n-doc-title]");
  if (docTitleEl) {
    const msg = t(docTitleEl.getAttribute("data-i18n-doc-title"));
    if (msg) document.title = msg;
  }
}
