/**
 * chrome.storage.local 快取層。
 *
 * Key 結構：cache:<domain>
 * Value：{ domain, registrationDate, ageDays, fetchedAt, status, errorReason }
 *
 * TTL：7 天。
 */

export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_PREFIX = "cache:";

function keyOf(domain) {
  return `${KEY_PREFIX}${domain}`;
}

/**
 * 讀取快取。過期回 null。
 *
 * @param {string} domain
 * @returns {Promise<object|null>}
 */
export async function getCache(domain) {
  if (!domain) return null;
  const k = keyOf(domain);
  try {
    const obj = await chrome.storage.local.get(k);
    const entry = obj[k];
    if (!entry || typeof entry !== "object") return null;
    if (typeof entry.fetchedAt !== "number") return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return entry;
  } catch (err) {
    console.warn("[BRO] cache read failed:", err);
    return null;
  }
}

/**
 * 寫入快取。自動補上 fetchedAt。
 *
 * 只 cache status === "ok" 的結果。unsupported / error 不 cache，
 * 因為這些代表「這次拿不到答案」，把它存 7 天會讓後續修復（fallback
 * 擴充、暫時性 5xx 復原、registry 補上 RDAP 等）對該網域完全失效。
 *
 * @param {string} domain
 * @param {object} data
 */
export async function setCache(domain, data) {
  if (!domain || !data) return;
  if (data.status !== "ok") return;
  const entry = { ...data, domain, fetchedAt: Date.now() };
  try {
    await chrome.storage.local.set({ [keyOf(domain)]: entry });
  } catch (err) {
    console.warn("[BRO] cache write failed:", err);
  }
}

/**
 * 清除所有 cache:* key。其他 key 保留。
 *
 * @returns {Promise<number>} 被清除的 key 數量
 */
export async function clearAllCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(KEY_PREFIX));
    if (keys.length > 0) {
      await chrome.storage.local.remove(keys);
    }
    return keys.length;
  } catch (err) {
    console.warn("[BRO] cache clear failed:", err);
    return 0;
  }
}

/**
 * 計算快取中目前有幾筆。
 */
export async function countCache() {
  try {
    const all = await chrome.storage.local.get(null);
    return Object.keys(all).filter(k => k.startsWith(KEY_PREFIX)).length;
  } catch {
    return 0;
  }
}
