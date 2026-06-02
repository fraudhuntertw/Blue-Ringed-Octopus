/**
 * RDAP API client。
 *
 * 端點：https://rdap.org/domain/{domain}
 *   — 會 302 轉址到該網域真正的註冊商 RDAP server。
 *   — Manifest host_permissions <all_urls> 已涵蓋此轉址。
 *
 * 回傳：events[] 中尋找 eventAction === "registration"（或常見變體），
 *      取 eventDate（ISO 8601）作為註冊時間。
 *
 * Mock 模式：設 USE_MOCK = true 切換為假資料，方便離線測試 UI。
 *   要切換到真實 API，把 USE_MOCK 改回 false 即可。
 */

const RDAP_ENDPOINT = "https://rdap.org/domain/";
const FETCH_TIMEOUT_MS = 8000;

// === Mock 開關 ===
// true  → 回傳假資料（5 天前註冊，會觸發告警）
// false → 打真的 RDAP API
const USE_MOCK = false;

// === Fallback RDAP server，給 rdap.org bootstrap 沒涵蓋但實際有 RDAP 的 TLD ===
// 偵測到 rdap.org 對該 TLD 回 404 時改打這裡。新增時鍵用小寫 TLD，
// 值是完整 domain 查詢前綴（會直接 concat domain）。
//
// 加新條目前請先實測：rdap.org 對該 TLD 確實 404，且 fallback endpoint 回 200。
//
// Identity Digital 後端（已實測）：.me .io .sh .ac .bz
//   — 含其他 Donuts/Afilias ccTLD（.ag .gd .lc .vc .mn .ws 等）也是同一後端，
//     需要再擴充時直接加 key 即可。
const ID_DIGITAL = "https://rdap.identitydigital.services/rdap/domain/";
const RDAP_TLD_FALLBACKS = {
  "me": ID_DIGITAL,
  "io": ID_DIGITAL,
  "sh": ID_DIGITAL,
  "ac": ID_DIGITAL,
  "bz": ID_DIGITAL,
};

// RDAP 規範的註冊事件動作為 "registration"，
// 但部分註冊商會用其他寫法，這裡寬鬆比對。
const REGISTRATION_ACTIONS = new Set([
  "registration", "registered", "domain registration", "create", "created",
]);

/**
 * 包一層 timeout 的 fetch。
 */
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      // RDAP 標準 Accept header
      headers: { "Accept": "application/rdap+json, application/json" },
      // 跟隨 302 是預設行為
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 從 RDAP JSON 中找出註冊日期。
 *
 * @param {object} data RDAP 回傳的 JSON
 * @returns {Date|null}
 */
function parseRegistrationDate(data) {
  if (!data || !Array.isArray(data.events)) return null;
  for (const ev of data.events) {
    if (!ev || typeof ev.eventAction !== "string") continue;
    if (REGISTRATION_ACTIONS.has(ev.eventAction.toLowerCase())) {
      if (typeof ev.eventDate === "string") {
        const d = new Date(ev.eventDate);
        if (!isNaN(d.getTime())) return d;
      }
    }
  }
  return null;
}

// === vCard 與 entity 解析 ===

/**
 * 從 vcardArray 取出指定 field 的值。
 * vcardArray 結構：["vcard", [["fn", {}, "text", "John"], ["email", {}, "text", "x@y"], ...]]
 */
function vcardGet(vcardArray, field) {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return null;
  const props = vcardArray[1];
  if (!Array.isArray(props)) return null;
  for (const prop of props) {
    if (Array.isArray(prop) && prop[0] === field && prop.length >= 4) {
      const v = prop[3];
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v.filter(s => typeof s === "string").join(" ");
    }
  }
  return null;
}

/**
 * 遞迴搜尋 entities 陣列，回傳第一個 roles 含指定角色的 entity。
 */
function findEntityByRole(entities, role) {
  if (!Array.isArray(entities)) return null;
  for (const ent of entities) {
    if (!ent || typeof ent !== "object") continue;
    if (Array.isArray(ent.roles) && ent.roles.includes(role)) return ent;
    if (Array.isArray(ent.entities)) {
      const nested = findEntityByRole(ent.entities, role);
      if (nested) return nested;
    }
  }
  return null;
}

// 常見的「資料被隱私服務遮罩」字串標記（小寫比對）。
const REDACTION_PATTERNS = [
  "redacted", "data protected", "not disclosed", "withheld",
  "privacy", "whoisguard", "whois protect", "domains by proxy",
  "domainsbyproxy", "domain by proxy", "anonymise", "anonymize",
  "statutory masking", "gdpr", "on behalf of",
  "contact privacy", "perfect privacy", "私隱保護", "隱私保護",
];

/**
 * 判斷字串看起來是否為「匿名/隱私遮罩」標記。
 */
function looksRedacted(value) {
  if (!value || typeof value !== "string") return true; // 沒值也視為不顯示
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return REDACTION_PATTERNS.some(p => v.includes(p));
}

/**
 * 從 entity 抽取人類可讀資料；任一欄位匿名則該欄位回 null。
 * 全部都匿名時整個物件回 null（讓呼叫端決定不顯示）。
 */
function extractPerson(entity) {
  if (!entity) return null;
  const name = vcardGet(entity.vcardArray, "fn");
  const email = vcardGet(entity.vcardArray, "email");
  const org = vcardGet(entity.vcardArray, "org");

  const cleanName = looksRedacted(name) ? null : name;
  const cleanEmail = looksRedacted(email) ? null : email;
  const cleanOrg = looksRedacted(org) ? null : org;

  if (!cleanName && !cleanEmail && !cleanOrg) return null;
  return { name: cleanName, email: cleanEmail, org: cleanOrg };
}

/**
 * 抽取註冊商資訊。
 * 名稱優先：vcardArray.fn > publicIds[].identifier > handle。
 * 註冊商通常不是隱私保護對象，所以不套用 redaction 判斷。
 */
function parseRegistrar(data) {
  const ent = findEntityByRole(data && data.entities, "registrar");
  if (!ent) return null;

  const fn = vcardGet(ent.vcardArray, "fn");
  let ianaId = null;
  if (Array.isArray(ent.publicIds)) {
    for (const pid of ent.publicIds) {
      if (pid && pid.type && /iana/i.test(pid.type) && pid.identifier) {
        ianaId = String(pid.identifier);
        break;
      }
    }
  }

  const name = fn || (ent.handle ? String(ent.handle) : null);
  if (!name && !ianaId) return null;
  return { name: name || null, ianaId };
}

/**
 * 抽取註冊人資訊（含匿名判斷）。
 */
function parseRegistrant(data) {
  const ent = findEntityByRole(data && data.entities, "registrant");
  return extractPerson(ent);
}

/**
 * 查詢網域註冊時間。
 *
 * 回傳格式：
 *   { status: "ok", registrationDate: ISO string, ageDays: number }
 *   { status: "unsupported", reason }      ← 例如 ccTLD 不支援 RDAP
 *   { status: "error", reason }            ← 網路 / HTTP 錯誤
 *
 * 注意：所有非 "ok" 的狀態都應由呼叫端視為「放行」，
 *      不應顯示告警，避免誤殺。
 *
 * @param {string} domain root domain（如 "example.com"）
 * @returns {Promise<object>}
 */
/**
 * 從網域取得最末段 TLD（小寫）。
 */
function tldOf(domain) {
  if (!domain || typeof domain !== "string") return "";
  const parts = domain.toLowerCase().split(".");
  return parts[parts.length - 1] || "";
}

/**
 * 嘗試打單一 RDAP endpoint，回傳 { ok, status, data, reason }。
 * 不負責解析欄位 — 解析交給上層。
 */
async function tryRdapEndpoint(url) {
  let resp;
  try {
    resp = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  } catch (err) {
    return { ok: false, status: 0, reason: `fetch failed: ${err.message || err}` };
  }
  if (!resp.ok) {
    return { ok: false, status: resp.status, reason: `HTTP ${resp.status}` };
  }
  try {
    const data = await resp.json();
    return { ok: true, status: resp.status, data };
  } catch (err) {
    return { ok: false, status: resp.status, reason: `invalid JSON: ${err.message || err}` };
  }
}

export async function fetchDomainAge(domain) {
  if (!domain) return { status: "error", reason: "empty domain" };

  if (USE_MOCK) {
    return mockFetch(domain);
  }

  // 1) 先打 rdap.org（涵蓋大多數 TLD 的 IANA bootstrap）
  const primary = await tryRdapEndpoint(RDAP_ENDPOINT + encodeURIComponent(domain));
  let data = primary.ok ? primary.data : null;

  // 2) rdap.org 回 404 → 看看是不是 IANA bootstrap 沒涵蓋但我們知道的 TLD
  if (!primary.ok && primary.status === 404) {
    const fallback = RDAP_TLD_FALLBACKS[tldOf(domain)];
    if (fallback) {
      console.info(`[BRO] rdap.org 404 for ${domain}, trying fallback ${fallback}`);
      const second = await tryRdapEndpoint(fallback + encodeURIComponent(domain));
      if (second.ok) {
        data = second.data;
      } else if (second.status === 404) {
        return { status: "unsupported", reason: "RDAP 404（fallback 也沒有）" };
      } else {
        return { status: "error", reason: `fallback ${second.reason}` };
      }
    } else {
      return { status: "unsupported", reason: "RDAP 404 (ccTLD 不支援或網域不存在)" };
    }
  }

  if (!data) {
    if (primary.status === 429) return { status: "error", reason: "rate limited (429)" };
    return { status: "error", reason: primary.reason || "unknown" };
  }

  const regDate = parseRegistrationDate(data);
  if (!regDate) {
    return { status: "unsupported", reason: "找不到 registration event" };
  }

  const ageDays = Math.floor((Date.now() - regDate.getTime()) / 86400000);
  return {
    status: "ok",
    registrationDate: regDate.toISOString(),
    ageDays,
    registrar: parseRegistrar(data),
    registrant: parseRegistrant(data),
  };
}

/**
 * Mock：回傳 5 天前註冊（會觸發告警）。
 * 改 daysAgo 可測試不同情境。
 */
function mockFetch(domain) {
  const daysAgo = 5;
  const regDate = new Date(Date.now() - daysAgo * 86400000);
  console.info(`[BRO] MOCK fetch for ${domain} → 註冊於 ${regDate.toISOString()}`);
  return {
    status: "ok",
    registrationDate: regDate.toISOString(),
    ageDays: daysAgo,
    registrar: { name: "Mock Registrar Inc.", ianaId: "9999" },
    registrant: { name: "John Mock", email: "mock@example.com", org: "Mock Corp" },
  };
}
