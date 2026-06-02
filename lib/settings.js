/**
 * 使用者設定（存在 chrome.storage.local）。
 *
 * 設定：
 *   - 告警門檻天數
 *   - 加強告警：黑名單命中時改為全畫面半透明蓋版（預設開）
 *   - 加強告警：低於門檻時改為全畫面半透明蓋版（預設關）
 *   - 加強告警：高風險 TLD 時改為全畫面半透明蓋版（預設關）
 */

const KEY_THRESHOLD = "warnThresholdDays";
const KEY_OVERLAY_BLACKLIST = "overlayBlacklist";
const KEY_OVERLAY_YOUNG = "overlayYoung";
const KEY_OVERLAY_HIGH_RISK_TLD = "overlayHighRiskTld";

export const DEFAULT_THRESHOLD = 30;
export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 3650;

/**
 * 讀取告警門檻。
 * 沒設定 / 值不合法 → 回預設 30。
 * @returns {Promise<number>}
 */
export async function getThreshold() {
  try {
    const obj = await chrome.storage.local.get(KEY_THRESHOLD);
    const v = obj[KEY_THRESHOLD];
    if (typeof v === "number" && Number.isFinite(v) && v >= MIN_THRESHOLD && v <= MAX_THRESHOLD) {
      return Math.floor(v);
    }
  } catch (err) {
    console.warn("[BRO] read threshold failed:", err);
  }
  return DEFAULT_THRESHOLD;
}

/**
 * 寫入告警門檻。
 * @param {number} days
 * @returns {Promise<{ok: boolean, value?: number, error?: string}>}
 */
export async function setThreshold(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return { ok: false, error: "not a number" };
  const floored = Math.floor(n);
  if (floored < MIN_THRESHOLD || floored > MAX_THRESHOLD) {
    return { ok: false, error: `out of range (${MIN_THRESHOLD}–${MAX_THRESHOLD})` };
  }
  try {
    await chrome.storage.local.set({ [KEY_THRESHOLD]: floored });
    return { ok: true, value: floored };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export const THRESHOLD_META = {
  default: DEFAULT_THRESHOLD,
  min: MIN_THRESHOLD,
  max: MAX_THRESHOLD,
};

// === 加強告警（全畫面蓋版）開關 ===

async function getBoolFlag(key, defaultValue = false) {
  try {
    const obj = await chrome.storage.local.get(key);
    const v = obj[key];
    if (typeof v === "boolean") return v;
    return defaultValue;
  } catch (err) {
    console.warn(`[BRO] read ${key} failed:`, err);
    return defaultValue;
  }
}

async function setBoolFlag(key, value) {
  const v = !!value;
  try {
    await chrome.storage.local.set({ [key]: v });
    return { ok: true, value: v };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export function getOverlayBlacklist() {
  return getBoolFlag(KEY_OVERLAY_BLACKLIST, true);
}

export function setOverlayBlacklist(value) {
  return setBoolFlag(KEY_OVERLAY_BLACKLIST, value);
}

export function getOverlayYoung() {
  return getBoolFlag(KEY_OVERLAY_YOUNG);
}

export function setOverlayYoung(value) {
  return setBoolFlag(KEY_OVERLAY_YOUNG, value);
}

export function getOverlayHighRiskTld() {
  return getBoolFlag(KEY_OVERLAY_HIGH_RISK_TLD);
}

export function setOverlayHighRiskTld(value) {
  return setBoolFlag(KEY_OVERLAY_HIGH_RISK_TLD, value);
}
