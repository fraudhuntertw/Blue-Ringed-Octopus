/**
 * 白名單、黑名單與高風險 TLD 清單管理。
 *
 * 白名單 / 黑名單存在 chrome.storage.local：
 *   - whitelist: string[]  使用者信任的網域，永不告警
 *   - blacklist: string[]  使用者標記為惡意的網域，造訪即告警
 *
 * 高風險 TLD 為內建清單（不可從 UI 編輯），改清單需要改這個檔案。
 * 參考：Spamhaus / Interisle / 各家威脅情報的常見濫用 TLD。
 */

const WHITELIST_KEY = "whitelist";
const BLACKLIST_KEY = "blacklist";

/**
 * 內建「可信 TLD」清單。
 * 命中此清單的網域會被視為白名單放行，且 popup 顯示綠色「可信 TLD」標籤。
 *
 * 收錄原則：只收台灣官方/教育 TLD，
 *           其他國家的管制 TLD 不收。
 *
 * 注意：trusted TLD 也可能被入侵（子網域接管、第三方服務被駭），
 *      此清單僅降低釣魚機率，不代表絕對安全。
 *
 * 比對方式：先比對最後兩段（多段 TLD），未命中再比對最後一段。
 */
const TRUSTED_TLDS = new Set([
  // 台灣（TWNIC 管制核發）
  "gov.tw",   // 政府
  "edu.tw",   // 教育
  "mil.tw",   // 軍方
]);

/**
 * 內建高風險 TLD。
 * 來源：Spamhaus 2024-2025 報告與業界常被點名的濫用熱點。
 *
 * 收錄原則（2026-05 收緊）：必須同時符合下列至少一項，
 * 才放進來 — 命中會觸發橙色橫幅，誤殺成本高。
 *   1. Spamhaus / Interisle Top 20 常客（明顯高濫用率）
 *   2. Donuts / Famous Four Media / BinkyMoon 系廉價 gTLD（廠商抗 abuse 速度慢）
 *   3. Freenom 系免費 ccTLD（雖 2023 停運但歷史污染未消）
 *
 * 刻意不收：
 *   - .info / .biz — Spamhaus 數據濫用率僅 ~1-2%，370 萬筆中合法網站為主
 *   - .tech / .shop / .store / .live / .link / .support / .world / .fun
 *     — 各有大量品牌、電商、活動頁面合法使用，加入會誤殺
 *   - .online / .site / .website — 太通用
 */
const HIGH_RISK_TLDS = new Set([
  // === Spamhaus 常客 ===
  "xyz", "top", "cyou", "click", "icu",

  // === Donuts / Famous Four 廉價 gTLD 群（高濫用、合法使用稀少）===
  "monster", "buzz", "gdn", "loan", "fit", "work",
  "country", "kim", "men", "stream", "download", "racing",
  "review", "trade", "party", "win", "bid", "date", "faith",
  "cricket", "science", "accountant", "webcam",

  // === Freenom 系免費 ccTLD（2023 已停運，歷史樣本仍存）===
  "tk", "ml", "ga", "cf", "gq",
]);

/**
 * 解析網域的「主要 TLD 段」（最後一段），用來比對高風險清單。
 * 注意：對多級 TLD（如 example.com.tw），這裡取的是 "tw"。
 * 多級 TLD 的高風險判斷以最末段為準，目前清單以此為設計。
 */
function getTld(domain) {
  if (!domain || typeof domain !== "string") return "";
  const parts = domain.toLowerCase().split(".");
  return parts[parts.length - 1] || "";
}

// === 高風險 TLD 使用者覆寫層 ===
// 設計：內建 HIGH_RISK_TLDS 保持唯讀，但使用者可從選項頁
//   a) 新增自己想標記的 TLD → 寫入 USER_HIGH_RISK_ADD
//   b) 停用內建中誤殺率高的 TLD → 寫入 USER_HIGH_RISK_REMOVE
// 有效清單 = (內建 ∪ user_add) − user_remove
// 這樣後續若更新內建清單，使用者的自訂仍會保留。

const USER_HIGH_RISK_ADD = "user_high_risk_tlds_add";
const USER_HIGH_RISK_REMOVE = "user_high_risk_tlds_remove";

function normalizeTld(s) {
  if (!s || typeof s !== "string") return "";
  // 接受 "xyz" / ".xyz" / "Xyz" 等輸入
  return s.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

async function getUserHighRiskOverrides() {
  try {
    const obj = await chrome.storage.local.get([USER_HIGH_RISK_ADD, USER_HIGH_RISK_REMOVE]);
    return {
      added: Array.isArray(obj[USER_HIGH_RISK_ADD]) ? obj[USER_HIGH_RISK_ADD] : [],
      removed: Array.isArray(obj[USER_HIGH_RISK_REMOVE]) ? obj[USER_HIGH_RISK_REMOVE] : [],
    };
  } catch (err) {
    console.warn("[BRO] read high-risk overrides failed:", err);
    return { added: [], removed: [] };
  }
}

/**
 * 判斷網域 TLD 是否為高風險（套用使用者覆寫）。
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
export async function isHighRiskTld(domain) {
  const tld = getTld(domain);
  if (!tld) return false;
  const { added, removed } = await getUserHighRiskOverrides();
  if (removed.includes(tld)) return false;
  if (added.includes(tld)) return true;
  return HIGH_RISK_TLDS.has(tld);
}

/**
 * 取得有效高風險 TLD 清單（內建 ∪ 自訂 − 停用），排序後回傳。
 * 給 popup / banner tag 顯示計數用。
 */
export async function getHighRiskTldList() {
  const { added, removed } = await getUserHighRiskOverrides();
  const set = new Set(HIGH_RISK_TLDS);
  for (const t of added) set.add(t);
  for (const t of removed) set.delete(t);
  return Array.from(set).sort();
}

/**
 * 取得帶來源標記的高風險 TLD 清單，給選項頁渲染用。
 * @returns {Promise<{
 *   builtin: Array<{ tld: string, disabled: boolean }>,
 *   userAdded: string[]
 * }>}
 */
export async function getHighRiskTldListWithOrigin() {
  const { added, removed } = await getUserHighRiskOverrides();
  const builtin = Array.from(HIGH_RISK_TLDS).sort()
    .map(t => ({ tld: t, disabled: removed.includes(t) }));
  const userAdded = added.filter(t => !HIGH_RISK_TLDS.has(t)).sort();
  return { builtin, userAdded };
}

/**
 * 使用者新增一個高風險 TLD。
 * 若該 TLD 是內建但被使用者停用 → 從 remove 清單拿掉（等於還原）。
 */
export async function addUserHighRiskTld(rawTld) {
  const t = normalizeTld(rawTld);
  if (!t) return { ok: false, reason: "empty" };
  if (!/^[a-z0-9-]+$/.test(t)) return { ok: false, reason: "invalid characters" };
  const { added, removed } = await getUserHighRiskOverrides();
  // 還原情境：內建被使用者停用 → 從 remove 拿掉
  if (HIGH_RISK_TLDS.has(t) && removed.includes(t)) {
    const newRemoved = removed.filter(x => x !== t);
    try {
      await chrome.storage.local.set({ [USER_HIGH_RISK_REMOVE]: newRemoved });
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
    return { ok: true, restored: true };
  }
  // 已是內建或已自訂 → 無需動作
  if (HIGH_RISK_TLDS.has(t)) return { ok: true, alreadyExists: true, source: "builtin" };
  if (added.includes(t)) return { ok: true, alreadyExists: true, source: "user" };
  // 真的新增
  const newAdded = added.concat([t]).sort();
  try {
    await chrome.storage.local.set({ [USER_HIGH_RISK_ADD]: newAdded });
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err) };
  }
  return { ok: true };
}

/**
 * 使用者移除一個高風險 TLD。
 * 若是自訂的 → 從 add 拿掉。
 * 若是內建的 → 加進 remove（停用），未來可以從選項頁「還原」。
 */
export async function removeUserHighRiskTld(rawTld) {
  const t = normalizeTld(rawTld);
  if (!t) return { ok: false, reason: "empty" };
  const { added, removed } = await getUserHighRiskOverrides();
  if (added.includes(t)) {
    const newAdded = added.filter(x => x !== t);
    try {
      await chrome.storage.local.set({ [USER_HIGH_RISK_ADD]: newAdded });
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
    return { ok: true };
  }
  if (HIGH_RISK_TLDS.has(t)) {
    if (removed.includes(t)) return { ok: true, alreadyDisabled: true };
    const newRemoved = removed.concat([t]).sort();
    try {
      await chrome.storage.local.set({ [USER_HIGH_RISK_REMOVE]: newRemoved });
    } catch (err) {
      return { ok: false, reason: String(err && err.message || err) };
    }
    return { ok: true, builtinDisabled: true };
  }
  return { ok: true, notFound: true };
}

/**
 * 判斷網域是否為可信 TLD。
 * 先比對最後兩段（多段 TLD，如 gov.tw、edu.tw），未命中再比對最後一段。
 * @param {string} domain
 * @returns {boolean}
 */
export function isTrustedTld(domain) {
  if (!domain || typeof domain !== "string") return false;
  const parts = domain.toLowerCase().split(".");
  if (parts.length >= 2) {
    const lastTwo = parts.slice(-2).join(".");
    if (TRUSTED_TLDS.has(lastTwo)) return true;
  }
  const last = parts[parts.length - 1];
  if (last && TRUSTED_TLDS.has(last)) return true;
  return false;
}

/**
 * 取得內建可信 TLD 清單（給 popup 顯示用）。
 */
export function getTrustedTldList() {
  return Array.from(TRUSTED_TLDS).sort();
}

/**
 * 內建高風險註冊商清單（**爭議性內容**）。
 *
 * 這些註冊商本身合法，但被釣魚 / 惡意軟體濫用的比例較高
 * （參考 Spamhaus 與 Interisle 的 Phishing Landscape 各年度報告）。
 * 命中時只在 popup 標示橘色提醒，**不會單獨觸發紅色橫幅告警**，
 * 以避免誤殺合法網站。
 *
 * 比對方式：對 RDAP 回傳的 registrar.name 做小寫子字串包含比對。
 * 例：清單放 "namecheap" 會命中「Namecheap, Inc.」與「NameCheap Inc」。
 *
 * 要新增或移除請編輯此 Set，popup 會自動反映。
 */
const HIGH_RISK_REGISTRARS = new Set([
  // 多年榜上有名（被濫用率高）
  "namecheap",
  "namesilo",
  "porkbun",
  "publicdomainregistry",
  "pdr ltd",
  "reg.ru",
  "openprovider",
  "hosting concepts",
  "key-systems",
  "internet domain service bs",
  "tucows",
  "alibaba",
  // 部分中港地區註冊商（特定研究曾點名）
  "west263",
  "xin net",
  "ename",
  "bizcn",
  "now.cn",
  // 多份公開威脅情報報告（2024-2025）點名近期釣魚集中的數家 registrar：
  // Chengdu West Dimension（西维数码，west.cn）：Spamhaus 2019 第 6 名，
  //   主打低價大量註冊，吸引濫用。
  "chengdu west dimension",
  "西维数码",
  "west.cn",
  // NameMart Limited（HK，IANA 3863）：PhishDestroy 報告通報後
  //   釣魚網域多未及時下架，abuse 處理消極。
  "namemart",
  // Gname.com（SG，IANA 1923）：NetBeacon 報告點名為近期釣魚集中的 registrar 之一。
  "gname",
]);

/**
 * 判斷註冊商名稱是否命中高風險清單。
 * 採用「清單詞為 registrar 名稱子字串」的寬鬆比對。
 *
 * @param {string|null|undefined} registrarName
 * @returns {boolean}
 */
export function isHighRiskRegistrar(registrarName) {
  if (!registrarName || typeof registrarName !== "string") return false;
  const n = registrarName.toLowerCase();
  for (const needle of HIGH_RISK_REGISTRARS) {
    if (n.includes(needle)) return true;
  }
  return false;
}

/**
 * 取得高風險註冊商清單（給 popup 顯示用）。
 */
export function getHighRiskRegistrarList() {
  return Array.from(HIGH_RISK_REGISTRARS).sort();
}

// === 白名單 / 黑名單 通用 CRUD ===

async function readList(key) {
  try {
    const obj = await chrome.storage.local.get(key);
    const v = obj[key];
    return Array.isArray(v) ? v : [];
  } catch (err) {
    console.warn(`[BRO] read ${key} failed:`, err);
    return [];
  }
}

async function writeList(key, list) {
  try {
    await chrome.storage.local.set({ [key]: list });
  } catch (err) {
    console.warn(`[BRO] write ${key} failed:`, err);
  }
}

function normalize(domain) {
  if (!domain || typeof domain !== "string") return "";
  return domain.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

async function addTo(key, domain) {
  const d = normalize(domain);
  if (!d) return { ok: false, reason: "empty" };
  const list = await readList(key);
  if (list.includes(d)) return { ok: true, alreadyExists: true, list };
  list.push(d);
  list.sort();
  await writeList(key, list);
  return { ok: true, list };
}

async function removeFrom(key, domain) {
  const d = normalize(domain);
  if (!d) return { ok: false, reason: "empty" };
  const list = await readList(key);
  const idx = list.indexOf(d);
  if (idx === -1) return { ok: true, notFound: true, list };
  list.splice(idx, 1);
  await writeList(key, list);
  return { ok: true, list };
}

// === Public API ===

export const getWhitelist = () => readList(WHITELIST_KEY);
export const addToWhitelist = (d) => addTo(WHITELIST_KEY, d);
export const removeFromWhitelist = (d) => removeFrom(WHITELIST_KEY, d);
export const isWhitelisted = async (domain) => {
  const d = normalize(domain);
  if (!d) return false;
  const list = await readList(WHITELIST_KEY);
  return list.includes(d);
};

export const getBlacklist = () => readList(BLACKLIST_KEY);
export const addToBlacklist = (d) => addTo(BLACKLIST_KEY, d);
export const removeFromBlacklist = (d) => removeFrom(BLACKLIST_KEY, d);
export const isBlacklisted = async (domain) => {
  const d = normalize(domain);
  if (!d) return false;
  const list = await readList(BLACKLIST_KEY);
  return list.includes(d);
};
