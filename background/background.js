/**
 * Background Service Worker (MV3, ES module)。
 *
 * 檢查流程：
 *   1. 監聽 tab 載入完成
 *   2. shouldSkip / extractRootDomain 過濾
 *   3. 黑名單命中 → 立即告警（reason: blacklist）
 *   4. 白名單命中 → 略過
 *   5. cache hit → 用 cache；miss → 呼叫 RDAP → setCache
 *   6. ageDays < 30 → 告警（reason: young），順便標 highRiskTld
 *   7. 其他狀態：放行（unsupported / error 都不告警）
 *
 * 注意：MV3 SW 會被休眠，所有狀態必須走 chrome.storage。
 */

import { extractRootDomain, shouldSkip, inspectDomainName } from "../lib/domain.js";
import { getCache, setCache, clearAllCache, countCache } from "../lib/cache.js";
import { fetchDomainAge } from "../lib/rdap.js";
import {
  getThreshold,
  setThreshold,
  THRESHOLD_META,
  getOverlayBlacklist,
  setOverlayBlacklist,
  getOverlayYoung,
  setOverlayYoung,
  getOverlayHighRiskTld,
  setOverlayHighRiskTld,
  getLockBlacklist,
  setLockBlacklist,
  getLockYoung,
  setLockYoung,
  getDetectOddName,
  setDetectOddName,
  getDetectBrandSpoof,
  setDetectBrandSpoof,
} from "../lib/settings.js";
import { findBrandSpoof, getBrandList } from "../lib/brands.js";
import { incRdapFetch, incCacheHit, incSkipByList, getStats } from "../lib/stats.js";
import {
  isHighRiskTld,
  isTrustedTld,
  isWhitelisted,
  isBlacklisted,
  getWhitelist,
  getBlacklist,
  addToWhitelist,
  removeFromWhitelist,
  addToBlacklist,
  removeFromBlacklist,
  getHighRiskTldList,
  getHighRiskTldListWithOrigin,
  addUserHighRiskTld,
  removeUserHighRiskTld,
  getTrustedTldList,
  isHighRiskRegistrar,
  getHighRiskRegistrarList,
} from "../lib/lists.js";
import { initI18n, t, LOCALE_STORAGE_KEY } from "../lib/i18n.js";

// === i18n bootstrap ===
// MV3 SW 隨時可能被休眠;listener 必須同步註冊,但 handler 內再 await。
let i18nReady = initI18n();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[LOCALE_STORAGE_KEY]) {
    i18nReady = initI18n();
  }
});

function formatBannerDate(iso) {
  if (!iso) return t("unknownDate");
  const d = new Date(iso);
  if (isNaN(d.getTime())) return t("unknownDate");
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * 把奇怪域名命中原因（"long" / "hyphen"）轉成在地化片語,
 * 例如「過長（超過 10 字）」、「含連字號 -」,多項以分隔符接起。
 * @param {string[]} reasons
 * @returns {string}
 */
function oddNameReasonText(reasons) {
  const list = Array.isArray(reasons) ? reasons : [];
  const parts = list
    .map(r => (r === "long" ? t("oddReasonLong") : r === "hyphen" ? t("oddReasonHyphen") : null))
    .filter(Boolean);
  if (parts.length === 0) return t("oddReasonGeneric");
  return parts.join(t("oddReasonSep"));
}

/**
 * 為 content script 預先格式化所有 user-visible 字串。
 * content.js 不直接讀 i18n,因為 MV3 content script 不支援 ES module,
 * 且把 _locales 開到 web_accessible_resources 不必要地擴大 attack surface。
 */
function buildContentStrings(payload) {
  let message = t("contentWarnGeneric");
  let title = t("overlayTitleGeneric");

  if (payload.reason === "blacklist") {
    message = t("contentWarnBlacklist", payload.domain);
    title = t("overlayTitleBlacklist");
  } else if (payload.reason === "young") {
    const regDate = formatBannerDate(payload.registrationDate);
    const ageDays = typeof payload.ageDays === "number" ? payload.ageDays : "?";
    const threshold = typeof payload.threshold === "number" ? payload.threshold : 30;
    message = t("contentWarnYoung", payload.domain, threshold, regDate, ageDays);
    title = t("overlayTitleYoung");
  } else if (payload.reason === "high_risk_tld") {
    const tld = payload.tld ? `.${payload.tld}` : t("tagHighRiskTld");
    message = t("contentWarnHighRiskTld", payload.domain, tld);
    title = t("overlayTitleHighRiskTld");
  } else if (payload.reason === "odd_name") {
    message = t("contentWarnOddName", payload.domain, oddNameReasonText(payload.oddNameReasons));
    title = t("overlayTitleOddName");
  } else if (payload.reason === "brand_subdomain") {
    // $2 必須是 brandToken（網址裡實際出現的字串）:約 2/3 的內建品牌顯示名是
    // 中文（蝦皮購物、中國信託…）,若宣稱「網址夾帶『蝦皮購物』字樣」,長輩對照
    // 網址列找不到該字樣,反而會懷疑警告本身。品牌名（$3）只用於「不是 XX 官方」。
    message = t("contentWarnBrandSpoof", payload.domain, payload.brandToken, payload.brandName, payload.brandOfficial);
    title = t("overlayTitleBrandSpoof");
  }

  const tags = [];
  if (payload.isHighRiskTld) {
    tags.push({ cls: "zm-tag zm-tag-tld", label: t("tagHighRiskTld") });
  }
  if (payload.reason === "blacklist") {
    tags.push({ cls: "zm-tag zm-tag-bl", label: t("tagBlacklist") });
  }
  if (payload.reason === "high_risk_tld" && payload.tld) {
    tags.push({ cls: "zm-tag zm-tag-tld", label: `.${payload.tld}` });
  }
  if (payload.reason === "odd_name") {
    tags.push({ cls: "zm-tag zm-tag-tld", label: t("tagOddName") });
  }
  if (payload.reason === "brand_subdomain") {
    tags.push({ cls: "zm-tag zm-tag-tld", label: t("tagBrandSpoof") });
  }

  // === 為何被標記:逐項證據 + 建議怎麼做（Q3）===
  // 把目前已抓回卻被丟棄的 registrar / redaction 訊號落地成可展開明細。
  const evidence = [];
  const tldStr = payload.tld
    ? `.${payload.tld}`
    : (payload.domain ? `.${payload.domain.split(".").pop()}` : null);

  if (payload.reason === "young") {
    const regDate = formatBannerDate(payload.registrationDate);
    const ageDays = typeof payload.ageDays === "number" ? payload.ageDays : "?";
    evidence.push({ label: t("evidenceAgeLabel"), detail: t("evidenceAgeDetail", ageDays, regDate) });
  }
  if (payload.reason === "blacklist") {
    evidence.push({ label: t("evidenceListLabel"), detail: t("evidenceBlacklistDetail") });
  }
  if (tldStr && (payload.reason === "high_risk_tld" || payload.isHighRiskTld)) {
    evidence.push({ label: t("evidenceTldLabel"), detail: t("evidenceTldDetail", tldStr) });
  }
  if (payload.highRiskRegistrar && payload.registrarName) {
    evidence.push({ label: t("evidenceRegistrarLabel"), detail: t("evidenceRegistrarDetail", payload.registrarName) });
  }
  if (payload.registrantRedacted) {
    evidence.push({ label: t("evidenceRedactedLabel"), detail: t("evidenceRedactedDetail") });
  }
  if (payload.reason === "odd_name" && payload.oddNameLabel) {
    evidence.push({
      label: t("evidenceOddNameLabel"),
      detail: t("evidenceOddNameDetail", payload.oddNameLabel, oddNameReasonText(payload.oddNameReasons)),
    });
  }
  if (payload.reason === "brand_subdomain" && payload.brandToken) {
    evidence.push({
      label: t("evidenceBrandSpoofLabel"),
      detail: t("evidenceBrandSpoofDetail", payload.brandToken, payload.brandName, payload.brandOfficial),
    });
  }

  let explain = t("explainGeneric");
  if (payload.reason === "young") explain = t("explainYoung");
  else if (payload.reason === "blacklist") explain = t("explainBlacklist");
  else if (payload.reason === "high_risk_tld") explain = t("explainHighRiskTld");
  else if (payload.reason === "odd_name") explain = t("explainOddName");
  else if (payload.reason === "brand_subdomain") explain = t("explainBrandSpoof");

  return {
    message,
    title,
    tags,
    evidence,
    explain,
    evidenceToggleLabel: t("evidenceToggle"),
    whatToDoLabel: t("evidenceWhatToDo"),
    markSafeLabel: t("markSafeBtn"),
    dismissLabel: t("overlayDismiss"),
    closeAriaLabel: t("closeAriaLabel"),
    lockedNote: t("warningLockedNote"),
  };
}

// === Icon 載入 ===
// 為什麼用 ImageData 而非 path：
//   ES module SW 中，chrome.action.setIcon({path: "..."}) 的相對路徑 base 是
//   SW 自己的位置（background/），不是 extension root → 內部 fetch 會 404。
//   改成自己用 chrome.runtime.getURL() 取絕對 URL → fetch → 解碼為 ImageData，
//   就避開了路徑解析問題（也順便把解碼結果 cache 起來）。
const ICON_SIZES = [16, 48, 128];
const IMAGE_DATA_CACHE = {
  normal: null,
  alert: null,
  warn: null,
  blacklist: null,
  whitelist: null,
};
const ICON_STATES = Object.keys(IMAGE_DATA_CACHE);

async function loadIconImageData(state /* "normal" | "alert" | "blacklist" | "whitelist" */) {
  if (!ICON_STATES.includes(state)) state = "normal";
  if (IMAGE_DATA_CACHE[state]) return IMAGE_DATA_CACHE[state];

  const out = {};
  for (const size of ICON_SIZES) {
    const url = chrome.runtime.getURL(`icons/octopus-${state}-${size}.png`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`fetch ${url} → HTTP ${resp.status}`);
    const blob = await resp.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    out[size] = ctx.getImageData(0, 0, size, size);
  }
  IMAGE_DATA_CACHE[state] = out;
  return out;
}

function setTabIcon(tabId, state) {
  loadIconImageData(state)
    .then(imageData => chrome.action.setIcon({ tabId, imageData }))
    .then(() => {
      console.info(`[BRO] setIcon ok tab=${tabId} state=${state}`);
    })
    .catch(err => {
      console.error(`[BRO] setIcon FAILED tab=${tabId} state=${state} err=`, err);
    });
}

// === 工具列風險分數 badge（Q2）===
// 在 5 態 icon 上疊一個 0–100 粗略風險分數 + 顏色階,不開 popup 就看得到
// 這頁有多危險。pass / 安全狀態清空 badge。
// 這是「粗分數」呈現層；待 H 的 verdict 聚合器落地後可改讀其精算分數。
function badgeForVerdict(verdict) {
  if (!verdict) return null;
  if (verdict.classification === "blacklist") return { text: "100", bg: "#1f2937" };
  if (verdict.classification === "young") {
    const thr = typeof verdict.threshold === "number" && verdict.threshold > 0 ? verdict.threshold : 30;
    const age = verdict.result && typeof verdict.result.ageDays === "number" ? verdict.result.ageDays : 0;
    const frac = Math.max(0, Math.min(1, age / thr));
    // 越年輕分數越高:剛註冊 ≈95,接近門檻 ≈70
    return { text: String(Math.round(95 - frac * 25)), bg: "#c0392b" };
  }
  if (verdict.brandSpoof) {
    // 子網域品牌偽裝:特異性最高的橘色訊號（整段 label 命中品牌且 eTLD+1 非官方）,
    // 分數高於高風險 TLD（55）/ registrar（40）/ 奇怪域名（30）。
    return { text: "60", bg: "#d97706" };
  }
  if (verdict.classification === "odd_name" && !verdict.highRiskTld && !verdict.highRiskRegistrar) {
    // 奇怪域名:提醒級、純結構啟發式,風險分數刻意低於高風險 TLD / registrar。
    // 只在「純 odd_name」(未同時命中高風險 TLD / registrar)時給 30。
    // 若同時命中高風險 TLD / registrar,則 fall through 到下方 warn 分支拿較高的
    // 55 / 40,避免「多偵測到一個可疑訊號反而把風險分數調降」的矛盾 —— 這在
    // 「高風險 TLD + RDAP 失敗 + 奇怪域名」情境尤其重要(maybeFlagOddName 會把
    // classification 從 unsupported/error 改寫成 odd_name)。
    return { text: "30", bg: "#d97706" };
  }
  if (verdict.iconState === "warn") {
    // 高風險 TLD / registrar（含 RDAP 拿不到但本地判定高風險 TLD）
    return { text: verdict.highRiskTld ? "55" : "40", bg: "#d97706" };
  }
  return null; // ok / trusted / whitelist / unsupported / error / not_queried → 不顯示
}

function updateBadge(tabId, verdict) {
  const b = badgeForVerdict(verdict);
  // chrome.action.setBadge* 回 Promise;tab 已關閉時是「非同步 reject」,try/catch
  // 攔不到(會變成 unhandled rejection)。對每個呼叫接 .catch 才能確實吞掉。
  // 部分舊版可能回 undefined,故先檢查 .catch 是否存在。
  const warn = err => console.warn(`[BRO] setBadge failed tab=${tabId}:`, err);
  const safe = p => { if (p && typeof p.catch === "function") p.catch(warn); };
  try {
    safe(chrome.action.setBadgeText({ tabId, text: b ? b.text : "" }));
    if (b) {
      safe(chrome.action.setBadgeBackgroundColor({ tabId, color: b.bg }));
      // setBadgeTextColor 在較舊 Chrome 可能不存在
      if (chrome.action.setBadgeTextColor) {
        safe(chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" }));
      }
    }
  } catch (err) {
    warn(err);
  }
}

/**
 * 奇怪域名 fallback：最低優先、提醒級的頂端橫幅。
 *
 * 只在「沒有任何更高優先告警（blacklist / young / high_risk_tld）」時才升級成橫幅
 * —— 同一頁只有一條橫幅,高優先者優先。v.oddName 已在 evaluateDomain 內套過開關
 * 閘控與黑/白/可信排除,故這裡只需檢查 warnReason 是否已被占用。
 *
 * 注意：即使這裡不升級成橫幅,v.oddName 仍保持為 true,讓 popup / lookup 能以
 * 標籤額外呈現「奇怪域名」訊號（標籤可疊加,不受單一橫幅名額限制）。
 *
 * @param {object} v verdict（就地修改後回傳）
 * @returns {object}
 */
function maybeFlagOddName(v) {
  if (v.warnReason || !v.oddName) return v;
  v.warnReason = "odd_name";
  if (v.iconState === "normal") v.iconState = "warn";
  // 沿用既有「非告警」分類時改標 odd_name；high_risk_registrar 等保留,
  // 讓 popup / badge 仍依其分類呈現,只是另外多了一條奇怪域名橫幅。
  if (["ok", "not_queried", "unsupported", "error"].includes(v.classification)) {
    v.classification = "odd_name";
  }
  return v;
}

/**
 * 子網域品牌偽裝（F8a）：提醒級的頂端橫幅。
 *
 * 優先序介於紅色告警與其他橘色提醒之間：絕不蓋過 blacklist / young（紅色,
 * 訊息更強烈）,但「允許」蓋過 high_risk_tld —— paypal.com.evil.xyz 這種情境,
 * 「網址假冒 PayPal」遠比「.xyz 是高風險 TLD」具體可行動;TLD 訊號仍以
 * isHighRiskTld 標籤與證據項保留呈現,不會遺失。
 *
 * v.brandSpoof 已在 evaluateDomain 內套過開關閘控與黑/白/可信排除;
 * 與 maybeFlagOddName 同樣,即使未升級成橫幅,旗標仍保留給 popup / lookup 標籤。
 *
 * @param {object} v verdict（就地修改後回傳）
 * @returns {object}
 */
function maybeFlagBrandSpoof(v) {
  if (!v.brandSpoof) return v;
  if (v.warnReason && v.warnReason !== "high_risk_tld") return v;
  v.warnReason = "brand_subdomain";
  if (v.iconState === "normal") v.iconState = "warn";
  if (["ok", "not_queried", "unsupported", "error", "high_risk_tld"].includes(v.classification)) {
    v.classification = "brand_subdomain";
  }
  return v;
}

/**
 * 純判定函式：對單一網域跑完整檢查鏈，回傳結構化 verdict。
 *
 * 設計重點（Q1 共用地基）：
 *   - 不碰 icon、不發 banner、不寫統計 —— 純粹「判定」。
 *     icon / banner / 統計交給呼叫端（checkTab）依 verdict 決定。
 *   - checkTab（被動,造訪時）與 CHECK_DOMAIN（主動,免造訪查詢）共用同一份邏輯,
 *     確保兩條路徑判定一致。
 *   - 短路順序與舊版 checkTab 完全相同：blacklist → whitelist → trustedTld → RDAP。
 *
 * @param {string} domain registrable domain（eTLD+1）
 * @param {{allowFetch?: boolean, hostname?: string|null}} opts
 *        allowFetch=false 時 cache miss 不打 RDAP（給「只看本地」用）;
 *        hostname 為完整 host,供「子網域品牌偽裝」偵測 —— 只有 checkTab /
 *        handleCheckDomain 拿得到並傳入,其他呼叫端（如 lockedReasonFor）不傳則跳過該偵測。
 * @returns {Promise<object>} verdict
 */
async function evaluateDomain(domain, { allowFetch = true, hostname = null } = {}) {
  const v = {
    domain,
    blacklisted: false,
    whitelisted: false,
    trustedTld: false,
    highRiskTld: false,
    highRiskRegistrar: false,
    // 奇怪域名（偵測奇怪域名功能）：主域名過長 / 含連字號。
    // 已套用開關閘控 + 排除白名單/可信/黑名單,故 true 代表「該顯示提醒」。
    oddName: false,
    oddNameReasons: [],           // ⊆ {"long","hyphen"}
    oddNameLabel: null,           // 命中的主域名 label（不含 TLD）
    // 子網域品牌偽裝（F8a）：子網域夾帶品牌 token 而 eTLD+1 非該品牌官方網域。
    // 已套用開關閘控 + 排除白名單/可信/黑名單,故 true 代表「該顯示提醒」。
    brandSpoof: false,
    brandSpoofBrand: null,        // 品牌顯示名（如 "PayPal"）
    brandSpoofToken: null,        // 命中的子網域 label（如 "paypal"）
    brandSpoofOfficial: null,     // 該品牌主要官方網域（如 "paypal.com"）
    threshold: null,
    result: null,
    // 衍生分類：blacklist / whitelist / trusted / young / high_risk_tld /
    //           high_risk_registrar / brand_subdomain / odd_name / ok /
    //           unsupported / error / not_queried
    classification: "ok",
    iconState: "normal",          // checkTab 用：normal / alert / warn / blacklist / whitelist
    warnReason: null,             // checkTab 用：要彈哪種橫幅（null=不彈）
    cacheHit: false,
    fetched: false,
  };

  // 黑名單優先（最強阻擋語意）
  if (await isBlacklisted(domain)) {
    v.blacklisted = true;
    v.highRiskTld = await isHighRiskTld(domain);
    v.classification = "blacklist";
    v.iconState = "blacklist";
    v.warnReason = "blacklist";
    return v;
  }

  // 白名單：放行
  if (await isWhitelisted(domain)) {
    v.whitelisted = true;
    v.classification = "whitelist";
    v.iconState = "whitelist";
    return v;
  }

  // 可信 TLD：視同自動白名單
  if (isTrustedTld(domain)) {
    v.trustedTld = true;
    v.classification = "trusted";
    v.iconState = "whitelist";
    return v;
  }

  // 奇怪域名訊號（開關閘控,純結構判斷,與 RDAP 無關）。
  // 在此計算為「顯示用旗標」：到這裡已排除黑/白名單與可信 TLD,只要開關開且命中
  // 規則即標記,供 popup / lookup 以標籤呈現。是否升級成「頂端橫幅」另由下方
  // maybeFlagOddName 決定（僅在沒有更高優先告警時）。
  if (await getDetectOddName()) {
    const insp = inspectDomainName(domain);
    if (insp.odd) {
      v.oddName = true;
      v.oddNameReasons = insp.reasons;
      v.oddNameLabel = insp.label;
    }
  }

  // 子網域品牌偽裝訊號（F8a,開關閘控,純本地比對,與 RDAP 無關）。
  // 同上,此處只計算「顯示用旗標」;是否升級成橫幅由 maybeFlagBrandSpoof 決定。
  // 需要完整 hostname,沒有傳入（如 lockedReasonFor 路徑）就跳過。
  if (hostname && (await getDetectBrandSpoof())) {
    const hit = findBrandSpoof(hostname, domain);
    if (hit) {
      v.brandSpoof = true;
      v.brandSpoofBrand = hit.brand;
      v.brandSpoofToken = hit.token;
      v.brandSpoofOfficial = hit.official;
    }
  }

  // 查詢註冊時間（cache → RDAP）
  let result = await getCache(domain);
  if (result) {
    v.cacheHit = true;
  } else if (allowFetch) {
    result = await fetchDomainAge(domain);
    v.fetched = true;
    await setCache(domain, result);
  }
  v.result = result || null;

  const registrarName = result && result.registrar ? result.registrar.name : null;
  v.highRiskTld = await isHighRiskTld(domain);
  v.highRiskRegistrar = isHighRiskRegistrar(registrarName);

  if (!result || result.status !== "ok" || typeof result.ageDays !== "number") {
    // RDAP 拿不到（unsupported / error / 未查）時,仍可用本地高風險 TLD 清單做判斷。
    // 高風險 TLD 是純本地查表（isHighRiskTld 不依賴 RDAP）,因此不該被 RDAP 失敗連坐:
    // .tk / .ga / .cf / .gq 等 Freenom 系 TLD 幾乎都不支援 RDAP（必走此分支）,
    // 若這裡不彈橫幅,README 點名要提醒的這些 TLD 反而永遠只剩一個工具列 icon,
    // 與功能初衷（提醒不熟悉的長輩）矛盾。故此處對高風險 TLD 也送橘色提醒橫幅。
    // 註:RDAP 年齡型「紅色告警」仍維持 fail-open（不誤殺），此處只補「橘色提醒」。
    v.classification = v.highRiskTld ? "high_risk_tld" : (result ? result.status : "not_queried");
    v.iconState = v.highRiskTld ? "warn" : "normal";
    if (v.highRiskTld) v.warnReason = "high_risk_tld";
    return maybeFlagOddName(maybeFlagBrandSpoof(v));
  }

  v.threshold = await getThreshold();
  if (result.ageDays < v.threshold) {
    v.classification = "young";
    v.iconState = "alert";
    v.warnReason = "young";
  } else if (v.highRiskTld || v.highRiskRegistrar) {
    // 註冊已久但 TLD / 註冊商屬高風險：橘色 warn icon
    v.iconState = "warn";
    v.classification = v.highRiskTld ? "high_risk_tld" : "high_risk_registrar";
    // 只有「高風險 TLD」會彈橘色橫幅；高風險 registrar 不彈,避免誤殺。
    if (v.highRiskTld) v.warnReason = "high_risk_tld";
  } else {
    v.classification = "ok";
    v.iconState = "normal";
  }
  return maybeFlagOddName(maybeFlagBrandSpoof(v));
}

/**
 * 對單一 tab 執行完整檢查流程。不會拋例外。
 * 判定邏輯委派給 evaluateDomain；本函式只負責 icon / banner / 統計。
 */
async function checkTab(tabId, url) {
  console.info(`[BRO] checkTab tab=${tabId} url=${url}`);

  if (shouldSkip(url)) {
    console.info(`[BRO]  → skip (shouldSkip)`);
    setTabIcon(tabId, "normal");
    updateBadge(tabId, null);
    return;
  }

  const domain = extractRootDomain(url);
  if (!domain) {
    console.info(`[BRO]  → skip (cannot parse domain)`);
    setTabIcon(tabId, "normal");
    updateBadge(tabId, null);
    return;
  }
  console.info(`[BRO]  → domain=${domain}`);

  // 完整 hostname 供品牌偽裝偵測（shouldSkip / extractRootDomain 已確認 URL 可解析）。
  const hostname = new URL(url).hostname;
  const verdict = await evaluateDomain(domain, { hostname });

  // 節流統計（與舊版 checkTab 語意一致）
  if (verdict.blacklisted || verdict.whitelisted || verdict.trustedTld) {
    incSkipByList();
  } else if (verdict.cacheHit) {
    incCacheHit();
  } else if (verdict.fetched) {
    incRdapFetch();
  }

  setTabIcon(tabId, verdict.iconState);
  updateBadge(tabId, verdict);

  if (verdict.warnReason === "blacklist") {
    console.info(`[BRO]  → ALERT (blacklisted)`);
    const [overlay, locked] = await Promise.all([getOverlayBlacklist(), getLockBlacklist()]);
    sendWarning(tabId, {
      domain,
      reason: "blacklist",
      isHighRiskTld: verdict.highRiskTld,
      overlay,
      locked,
    });
  } else if (verdict.warnReason === "young") {
    console.info(`[BRO]  → ALERT (young, ${verdict.result.ageDays} < ${verdict.threshold} days)`);
    const [overlay, locked] = await Promise.all([getOverlayYoung(), getLockYoung()]);
    sendWarning(tabId, {
      domain,
      reason: "young",
      registrationDate: verdict.result.registrationDate,
      ageDays: verdict.result.ageDays,
      threshold: verdict.threshold,
      isHighRiskTld: verdict.highRiskTld,
      registrarName: verdict.result.registrar ? verdict.result.registrar.name : null,
      highRiskRegistrar: verdict.highRiskRegistrar,
      registrantRedacted: verdict.result.status === "ok" && !verdict.result.registrant,
      overlay,
      locked,
    });
  } else if (verdict.warnReason === "high_risk_tld") {
    console.info(`[BRO]  → orange warn (high-risk TLD)`);
    const overlay = await getOverlayHighRiskTld();
    // result 可能為 null（RDAP unsupported/error 時仍對高風險 TLD 彈橫幅）—— 全部 null-safe。
    const r = verdict.result;
    sendWarning(tabId, {
      domain,
      reason: "high_risk_tld",
      tld: domain.split(".").pop(),
      ageDays: r ? r.ageDays : null,
      registrationDate: r ? r.registrationDate : null,
      registrarName: r && r.registrar ? r.registrar.name : null,
      highRiskRegistrar: verdict.highRiskRegistrar,
      registrantRedacted: !!(r && r.status === "ok" && !r.registrant),
      overlay,
    });
  } else if (verdict.warnReason === "brand_subdomain") {
    console.info(`[BRO]  → brand-spoof warn ("${verdict.brandSpoofToken}" vs ${verdict.brandSpoofOfficial})`);
    // 品牌偽裝本身無蓋版選項;但它可能蓋過 high_risk_tld 的橫幅名額 —— 若使用者
    // 已開「高風險 TLD 蓋版」且本頁確實命中高風險 TLD,不可把使用者明確選擇的
    // 加強告警靜默降級成可關閉橫幅,沿用蓋版（標題/文案仍是更具體的品牌偽裝版）。
    const overlay = verdict.highRiskTld ? await getOverlayHighRiskTld() : false;
    // registrar / redaction 證據與 high_risk_tld 分支同口徑帶上,
    // 避免「多一個品牌訊號,反而少了註冊商證據列」的回退。result 可能為 null。
    const r = verdict.result;
    sendWarning(tabId, {
      domain,
      reason: "brand_subdomain",
      brandName: verdict.brandSpoofBrand,
      brandToken: verdict.brandSpoofToken,
      brandOfficial: verdict.brandSpoofOfficial,
      isHighRiskTld: verdict.highRiskTld,
      ageDays: r ? r.ageDays : null,
      registrationDate: r ? r.registrationDate : null,
      registrarName: r && r.registrar ? r.registrar.name : null,
      highRiskRegistrar: verdict.highRiskRegistrar,
      registrantRedacted: !!(r && r.status === "ok" && !r.registrant),
      overlay,
    });
  } else if (verdict.warnReason === "odd_name") {
    console.info(`[BRO]  → odd-name warn (${verdict.oddNameReasons.join(",")})`);
    // 奇怪域名：提醒級、永遠頂端橫幅、無蓋版（不傳 overlay）。
    sendWarning(tabId, {
      domain,
      reason: "odd_name",
      oddNameReasons: verdict.oddNameReasons,
      oddNameLabel: verdict.oddNameLabel,
      isHighRiskTld: verdict.highRiskTld,
    });
  } else {
    console.info(`[BRO]  → pass/no-banner (classification=${verdict.classification}, icon=${verdict.iconState})`);
  }
}

function sendWarning(tabId, payload) {
  const strings = buildContentStrings(payload);
  chrome.tabs.sendMessage(tabId, { type: "SHOW_WARNING", payload: { ...payload, strings } })
    .catch(err => {
      console.warn(`[BRO] sendMessage to tab ${tabId} failed:`, err.message || err);
    });
}

// === 免造訪查詢台（Q1）===
// 常見短網址 / 轉址服務（含台灣常見）。命中時提醒使用者：
// BRO 只查得到短網址服務本身,看不到它最終會把人導去哪裡。
// 這正是 LINE / 簡訊釣魚最常見的包裝方式,必須誠實標示而非給假安全感。
const URL_SHORTENERS = new Set([
  // 全球
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "is.gd", "v.gd", "ow.ly",
  "buff.ly", "cutt.ly", "rebrand.ly", "rb.gy", "shorturl.at", "tiny.cc",
  "t.ly", "bl.ink", "soo.gd", "s.id", "dub.sh", "shorturl.com",
  // 台灣常見
  "reurl.cc", "pse.is", "psee.io", "lihi.cc", "lihi1.cc", "lihi2.cc",
  "lihi3.cc", "lihi.io", "lihi.tv", "ppt.cc", "0rz.tw", "myppt.cc",
  "risu.io", "tr.ee", "han.gl", "lurl.cc", "sl.ink",
]);

/**
 * 免造訪查詢:輸入一個 URL / 網域,跑 evaluateDomain 回傳 verdict。
 * 不改變任何 tab 的 icon / banner —— 純查詢。
 *
 * 重要定位:這是「風險訊號查詢」,不是「詐騙與否的判定」。
 * 短網址無法看到最終目的地 → 以 isShortener 旗標讓 popup 明確警示。
 *
 * @param {string} rawInput 使用者貼上的字串（URL 或裸網域）
 * @returns {Promise<object>}
 */
async function handleCheckDomain(rawInput) {
  if (typeof rawInput !== "string" || !rawInput.trim()) {
    return { ok: true, state: "empty" };
  }
  // 去掉前後空白與常見包覆字元（角括號 / 引號,常見於貼上）
  let input = rawInput.trim().replace(/^[<"'\s]+|[>"'\s]+$/g, "");
  // 沒有 scheme 就補 https:// 以利 URL 解析
  const urlStr = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;

  let host;
  try {
    host = new URL(urlStr).hostname.toLowerCase();
  } catch {
    return { ok: true, state: "invalid" };
  }

  if (shouldSkip(urlStr)) {
    return { ok: true, state: "skipped", host };
  }

  const domain = extractRootDomain(urlStr);
  if (!domain) {
    return { ok: true, state: "invalid_domain", host };
  }

  const isShortener = URL_SHORTENERS.has(domain);
  const verdict = await evaluateDomain(domain, { allowFetch: true, hostname: host });

  // 查詢台也會用到 RDAP,計入節流統計（與 checkTab 同口徑）
  if (verdict.fetched) incRdapFetch();
  else if (verdict.cacheHit) incCacheHit();
  else if (verdict.blacklisted || verdict.whitelisted || verdict.trustedTld) incSkipByList();

  return { ok: true, state: "checked", host, domain, isShortener, verdict };
}

/**
 * 誤報一鍵「標記安全」(Q4):把網域加入白名單。
 * 安全:只接受來自頁面 content script 的請求(sender.tab 存在),
 * 避免被任意網頁 / 外部來源偽造把釣魚域洗白。
 *
 * @param {string} domain
 * @param {chrome.runtime.MessageSender} sender
 */
/**
 * 判斷某網域目前是否「受鎖定」—— 鎖定守門的單一事實來源。
 *
 * 關鍵:判斷不可依賴 RDAP cache。cache 有 7 天 TTL、可被清除、SW 重啟後可能冷,
 * 若沿用 allowFetch:false 會在 cache miss 時把 young 誤判成 not_queried 而 fail-open,
 * 讓「曾被鎖定」的短註冊網域被洗白（審查 finding #1/#4）。
 * 因此這裡在「確實有開鎖定」時允許補抓一次 RDAP（allowFetch:true）取得權威分類。
 * 這條路徑是低頻、使用者主動觸發,補抓一次 RDAP 可接受。
 *
 * fail-closed:lockYoung 開啟時,若這次拿不到權威的 RDAP「ok」結論
 * （unsupported / error / 未查）, 就不能斷定「已非 young」而放行洗白 —— 否則
 * RDAP 暫時失靈（逾時 / 429 / cache 過期）即可繞過鎖定。此時回 "indeterminate"
 * 讓上層擋下,由 popup 提示「目前無法確認,請稍後再試或從選項頁解除」。
 *
 * @param {string} domain
 * @returns {Promise<null | "blacklist" | "young" | "indeterminate">} 命中鎖定的原因,未鎖定回 null
 */
async function lockedReasonFor(domain) {
  const [lockBl, lockYoung] = await Promise.all([getLockBlacklist(), getLockYoung()]);
  if (!lockBl && !lockYoung) return null;
  const v = await evaluateDomain(domain, { allowFetch: true });
  // 鎖定守門用到的 RDAP 查詢也計入節流統計（與 checkTab / handleCheckDomain 同口徑）。
  if (v.fetched) incRdapFetch();
  else if (v.cacheHit) incCacheHit();
  else if (v.blacklisted || v.whitelisted || v.trustedTld) incSkipByList();

  if (lockBl && v.classification === "blacklist") return "blacklist";
  if (lockYoung) {
    if (v.classification === "young") return "young";
    // blacklist / whitelist / trusted 是 RDAP 之前就確定的分類,與 young 無關,不鎖。
    const settled = ["blacklist", "whitelist", "trusted"].includes(v.classification);
    // 是否取得權威的 RDAP ok 結論（能據以斷定「已非 young」）。不看 classification,
    // 因為 maybeFlagOddName 會把 unsupported/error 改寫成 odd_name —— 改看原始 result。
    const authoritative = !!(v.result && v.result.status === "ok" && typeof v.result.ageDays === "number");
    if (!settled && !authoritative) return "indeterminate";
  }
  return null;
}

async function handleMarkFalsePositive(domain, sender) {
  if (!sender || !sender.tab) return { ok: false, reason: "bad sender" };
  if (!domain || typeof domain !== "string") return { ok: false, reason: "empty" };
  // 鎖定防護（縱深防禦）:即使頁面端按鈕已被移除,仍在此再擋一次,
  // 拒絕任何「從頁面把已鎖定網域洗白」的請求。解除只能走選項頁。
  const lockKind = await lockedReasonFor(domain);
  if (lockKind) {
    console.info(`[BRO] MARK_FALSE_POSITIVE blocked (${lockKind} locked): ${domain}`);
    return { ok: false, reason: lockKind === "indeterminate" ? "lock_indeterminate" : "locked", lockKind };
  }
  console.info(`[BRO] MARK_FALSE_POSITIVE → whitelist ${domain}`);
  return addToWhitelist(domain);
}

/**
 * popup 端的名單變更守門。
 * popup 的「加入白名單 / 移出黑名單」會把訊息帶上 enforceLock:true,
 * 這些「會削弱保護」的動作在鎖定時一律擋下（不依賴 cache,見 lockedReasonFor）。
 * 選項頁用的是同名訊息但不帶 enforceLock —— 它是唯一授權的解除途徑,不受守門影響。
 *
 * @param {"ADD_WHITELIST"|"REMOVE_BLACKLIST"} type
 * @param {string} domain
 */
async function handleGuardedMutation(type, domain) {
  if (!domain || typeof domain !== "string") return { ok: false, reason: "empty" };
  const lockKind = await lockedReasonFor(domain);
  if (lockKind) {
    console.info(`[BRO] ${type} blocked (${lockKind} locked): ${domain}`);
    return { ok: false, reason: lockKind === "indeterminate" ? "lock_indeterminate" : "locked", lockKind };
  }
  return type === "ADD_WHITELIST" ? addToWhitelist(domain) : removeFromBlacklist(domain);
}

// === Tab 載入完成監聽 ===
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab || !tab.url) return;
  // 等 i18n 載入完成,確保 sendWarning 能拿到翻譯字串
  i18nReady.then(() => checkTab(tabId, tab.url)).catch(err => {
    console.warn("[BRO] checkTab failed:", err);
  });
});

// === 訊息分派 ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;

  const handlers = {
    GET_STATUS: () => handleGetStatus(msg.url),
    CHECK_DOMAIN: () => handleCheckDomain(msg.input),
    MARK_FALSE_POSITIVE: () => handleMarkFalsePositive(msg.domain, sender),
    CLEAR_CACHE: () => clearAllCache().then(n => ({ ok: true, cleared: n })),
    GET_CACHE_COUNT: () => countCache().then(n => ({ count: n })),

    GET_WHITELIST: () => getWhitelist().then(list => ({ list })),
    // enforceLock:true（來自 popup）→ 套用鎖定守門;選項頁不帶此旗標,為授權解除途徑。
    ADD_WHITELIST: () => msg.enforceLock
      ? handleGuardedMutation("ADD_WHITELIST", msg.domain)
      : addToWhitelist(msg.domain),
    REMOVE_WHITELIST: () => removeFromWhitelist(msg.domain),

    GET_BLACKLIST: () => getBlacklist().then(list => ({ list })),
    ADD_BLACKLIST: () => addToBlacklist(msg.domain),
    REMOVE_BLACKLIST: () => msg.enforceLock
      ? handleGuardedMutation("REMOVE_BLACKLIST", msg.domain)
      : removeFromBlacklist(msg.domain),

    GET_HIGH_RISK_TLDS: () => getHighRiskTldList().then(list => ({ list })),
    GET_HIGH_RISK_TLDS_DETAIL: () => getHighRiskTldListWithOrigin(),
    ADD_HIGH_RISK_TLD: () => addUserHighRiskTld(msg.tld),
    REMOVE_HIGH_RISK_TLD: () => removeUserHighRiskTld(msg.tld),
    GET_TRUSTED_TLDS: () => Promise.resolve({ list: getTrustedTldList() }),
    GET_HIGH_RISK_REGISTRARS: () => Promise.resolve({ list: getHighRiskRegistrarList() }),

    GET_THRESHOLD: () => getThreshold().then(v => ({ value: v, meta: THRESHOLD_META })),
    SET_THRESHOLD: () => setThreshold(msg.days),

    GET_OVERLAY_FLAGS: () => Promise.all([getOverlayBlacklist(), getOverlayYoung(), getOverlayHighRiskTld()])
      .then(([blacklist, young, highRiskTld]) => ({ flags: { blacklist, young, highRiskTld } })),
    SET_OVERLAY_BLACKLIST: () => setOverlayBlacklist(msg.value),
    SET_OVERLAY_YOUNG: () => setOverlayYoung(msg.value),
    SET_OVERLAY_HIGH_RISK_TLD: () => setOverlayHighRiskTld(msg.value),

    GET_LOCK_FLAGS: () => Promise.all([getLockBlacklist(), getLockYoung()])
      .then(([blacklist, young]) => ({ flags: { blacklist, young } })),
    SET_LOCK_BLACKLIST: () => setLockBlacklist(msg.value),
    SET_LOCK_YOUNG: () => setLockYoung(msg.value),

    GET_DETECT_ODD_NAME: () => getDetectOddName().then(value => ({ value })),
    SET_DETECT_ODD_NAME: () => setDetectOddName(msg.value),

    GET_DETECT_BRAND_SPOOF: () => getDetectBrandSpoof().then(value => ({ value })),
    SET_DETECT_BRAND_SPOOF: () => setDetectBrandSpoof(msg.value),
    GET_BRAND_LIST: () => Promise.resolve({ list: getBrandList() }),

    GET_SESSION_STATS: () => getStats().then(s => ({ stats: s })),
  };

  const handler = handlers[msg.type];
  if (!handler) return false;

  handler().then(sendResponse).catch(err => {
    console.warn(`[BRO] handler ${msg.type} failed:`, err);
    sendResponse({ ok: false, error: String(err) });
  });
  return true; // async response
});

async function handleGetStatus(url) {
  if (!url) return { state: "no_url" };
  if (shouldSkip(url)) return { state: "skipped" };

  const domain = extractRootDomain(url);
  if (!domain) return { state: "invalid_domain" };

  const [blacklisted, whitelisted, cached, threshold, highRiskTld, lockBlacklist, lockYoung, detectOddName, detectBrandSpoof] = await Promise.all([
    isBlacklisted(domain),
    isWhitelisted(domain),
    getCache(domain),
    getThreshold(),
    isHighRiskTld(domain),
    getLockBlacklist(),
    getLockYoung(),
    getDetectOddName(),
    getDetectBrandSpoof(),
  ]);

  const registrarName = cached && cached.registrar ? cached.registrar.name : null;
  // 奇怪域名（開關開啟時才評估）：黑名單 / 白名單命中時不顯示此提醒（已有更明確狀態）。
  const oddInsp = (detectOddName && !blacklisted && !whitelisted && !isTrustedTld(domain))
    ? inspectDomainName(domain)
    : { odd: false, label: null, reasons: [] };
  // 子網域品牌偽裝（同上閘控;shouldSkip 已通過,URL 必可解析）。
  const brandHit = (detectBrandSpoof && !blacklisted && !whitelisted && !isTrustedTld(domain))
    ? findBrandSpoof(new URL(url).hostname, domain)
    : null;
  return {
    state: cached ? "cached" : "not_queried",
    domain,
    blacklisted,
    whitelisted,
    trustedTld: isTrustedTld(domain),
    highRiskTld,
    highRiskRegistrar: isHighRiskRegistrar(registrarName),
    oddName: oddInsp.odd,
    oddNameReasons: oddInsp.reasons,
    oddNameLabel: oddInsp.label,
    brandSpoof: !!brandHit,
    brandSpoofBrand: brandHit ? brandHit.brand : null,
    brandSpoofToken: brandHit ? brandHit.token : null,
    brandSpoofOfficial: brandHit ? brandHit.official : null,
    threshold,
    result: cached || null,
    // 鎖定旗標:讓 popup 決定是否停用「加入白名單 / 移出黑名單」按鈕
    lockBlacklist,
    lockYoung,
  };
}

chrome.runtime.onInstalled.addListener(details => {
  console.info(`[BRO] installed/updated (${details.reason})`);
});
