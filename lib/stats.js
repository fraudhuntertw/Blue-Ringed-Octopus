/**
 * 工作階段統計（節流效益指標）。
 *
 * 用 chrome.storage.session（瀏覽器重啟自動歸零）紀錄三類事件：
 *   - rdapFetches  ：實際發出 RDAP 請求的次數
 *   - cacheHits    ：cache 命中、不打 RDAP
 *   - skipByList   ：黑/白/可信 TLD 命中，跳過 RDAP
 *
 * 後兩者是「白名單機制省下的查詢」，總節流次數 = cacheHits + skipByList。
 *
 * 注意：chrome.storage.session 在 MV3 SW 各次喚醒間保留資料，
 *      但瀏覽器關閉時清空，符合「本次工作階段」語意。
 */

const STATS_KEY = "session_stats";

const ZERO_STATS = Object.freeze({
  rdapFetches: 0,
  cacheHits: 0,
  skipByList: 0,
});

async function readStats() {
  try {
    const obj = await chrome.storage.session.get(STATS_KEY);
    const v = obj[STATS_KEY];
    if (!v || typeof v !== "object") return { ...ZERO_STATS };
    return {
      rdapFetches: Number(v.rdapFetches) || 0,
      cacheHits: Number(v.cacheHits) || 0,
      skipByList: Number(v.skipByList) || 0,
    };
  } catch (err) {
    console.warn("[BRO] readStats failed:", err);
    return { ...ZERO_STATS };
  }
}

async function writeStats(stats) {
  try {
    await chrome.storage.session.set({ [STATS_KEY]: stats });
  } catch (err) {
    console.warn("[BRO] writeStats failed:", err);
  }
}

async function inc(field) {
  const stats = await readStats();
  if (!(field in stats)) return;
  stats[field] = (stats[field] || 0) + 1;
  await writeStats(stats);
}

export const incRdapFetch = () => inc("rdapFetches");
export const incCacheHit = () => inc("cacheHits");
export const incSkipByList = () => inc("skipByList");
export const getStats = () => readStats();
