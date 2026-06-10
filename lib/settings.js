/**
 * 使用者設定（存在 chrome.storage.local）。
 *
 * 設定：
 *   - 告警門檻天數
 *   - 加強告警：黑名單命中時改為全畫面半透明蓋版（預設開）
 *   - 加強告警：低於門檻時改為全畫面半透明蓋版（預設關）
 *   - 加強告警：高風險 TLD 時改為全畫面半透明蓋版（預設關）
 *   - 鎖定告警：黑名單命中時告警無法關閉、無法從網頁/popup 洗白（預設關）
 *   - 鎖定告警：低於門檻時告警無法關閉、無法從網頁/popup 洗白（預設關）
 *   - 偵測奇怪域名：主域名過長或含連字號時於網頁上方顯示提醒橫幅（預設關,無蓋版）
 *   - 偵測子網域品牌偽裝：子網域夾帶品牌 token 而 eTLD+1 非官方網域時提醒（預設開,無蓋版）
 *
 * 鎖定（lock）與蓋版（overlay）是兩件事：蓋版改變「呈現方式」(橫幅 → 蓋版),
 * 鎖定改變「能否解除」—— 開啟後該類告警移除所有關閉/略過/加入白名單入口,
 * 只能從選項頁調整或（短註冊網域）等到超過門檻天數自動解除。
 * 用途：後輩設定後，可防止長輩在網頁上亂點忽略告警。
 */

const KEY_THRESHOLD = "warnThresholdDays";
const KEY_OVERLAY_BLACKLIST = "overlayBlacklist";
const KEY_OVERLAY_YOUNG = "overlayYoung";
const KEY_OVERLAY_HIGH_RISK_TLD = "overlayHighRiskTld";
const KEY_LOCK_BLACKLIST = "lockBlacklist";
const KEY_LOCK_YOUNG = "lockYoung";
const KEY_DETECT_ODD_NAME = "detectOddName";
const KEY_DETECT_BRAND_SPOOF = "detectBrandSpoof";

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

// === 鎖定告警（無法忽略）開關 ===
// 開啟後：對應類別的告警移除「關閉 / 我已了解 / 加入白名單」入口,
// 且 popup 對應的「加入白名單 / 移出黑名單」按鈕一併停用,
// 解除途徑僅剩選項頁（或短註冊網域等到超過門檻自動放行）。預設皆關。

export function getLockBlacklist() {
  return getBoolFlag(KEY_LOCK_BLACKLIST);
}

export function setLockBlacklist(value) {
  return setBoolFlag(KEY_LOCK_BLACKLIST, value);
}

export function getLockYoung() {
  return getBoolFlag(KEY_LOCK_YOUNG);
}

export function setLockYoung(value) {
  return setBoolFlag(KEY_LOCK_YOUNG, value);
}

// === 偵測奇怪域名（提醒級橫幅,無蓋版）開關 ===
// 開啟後：主域名（不含 TLD）超過 10 字或含連字號 "-" 時,於網頁上方顯示橘色
// 提醒橫幅。純結構判斷,與 RDAP 無關;為最低優先,僅在沒有更高告警時才彈。預設關。

export function getDetectOddName() {
  return getBoolFlag(KEY_DETECT_ODD_NAME);
}

export function setDetectOddName(value) {
  return setBoolFlag(KEY_DETECT_ODD_NAME, value);
}

// === 偵測子網域品牌偽裝（提醒級橫幅,無蓋版）開關 ===
// 開啟後：子網域夾帶內建品牌 token 而 eTLD+1 非該品牌官方網域時
// （paypal.com.evil.xyz 型態）,於網頁上方顯示橘色提醒橫幅。
// 純本地比對、特異性高（誤殺低）,故預設開;選項頁可關。

export function getDetectBrandSpoof() {
  return getBoolFlag(KEY_DETECT_BRAND_SPOOF, true);
}

export function setDetectBrandSpoof(value) {
  return setBoolFlag(KEY_DETECT_BRAND_SPOOF, value);
}
