/**
 * 網域解析與排除清單。
 *
 * extractRootDomain(url)：從 URL 取出 registrable domain（eTLD+1），
 *                        以 Public Suffix List 為準（含 ICANN + PRIVATE 兩段）。
 * shouldSkip(url)：判斷此 URL 是否應跳過檢查（內部協議、私有 IP、localhost…）。
 */

import { PSL_RULES } from "./public-suffix-list.js";

const SKIP_SCHEMES = new Set([
  "chrome:", "chrome-extension:", "chrome-search:", "chrome-devtools:",
  "edge:", "extension:", "moz-extension:", "about:", "file:", "view-source:",
  "data:", "blob:", "javascript:",
]);

const SKIP_HOSTS = new Set([
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
]);

/**
 * 判斷字串是否為 IPv4 位址。
 */
function isIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  return m.slice(1).every(o => {
    const n = parseInt(o, 10);
    return n >= 0 && n <= 255;
  });
}

/**
 * 判斷字串是否為 IPv6 位址（簡化判斷：含 ::, 或 7 個冒號）。
 */
function isIPv6(host) {
  // 移除前後方括號（URL host 形式）
  const h = host.replace(/^\[|\]$/g, "");
  return h.includes("::") || (h.match(/:/g) || []).length >= 2;
}

/**
 * 判斷是否為私有 / 保留 IPv4 段。
 */
function isPrivateIPv4(host) {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split(".").map(Number);
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 0.0.0.0/8
  if (a === 0) return true;
  return false;
}

/**
 * 判斷是否應跳過檢查。
 * 條件：內部協議、localhost、私有 IP、純 IP 位址。
 *
 * @param {string} url 完整 URL 字串
 * @returns {boolean}
 */
export function shouldSkip(url) {
  if (!url || typeof url !== "string") return true;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  if (SKIP_SCHEMES.has(parsed.protocol)) return true;
  if (!["http:", "https:"].includes(parsed.protocol)) return true;

  const host = parsed.hostname.toLowerCase();
  if (!host) return true;
  if (SKIP_HOSTS.has(host)) return true;
  if (isIPv4(host) || isPrivateIPv4(host)) return true;
  if (isIPv6(host)) return true;

  // 沒有任何點的純字串（如 intranet hostname）也跳過
  if (!host.includes(".")) return true;

  return false;
}

/**
 * 依 Public Suffix List 演算法找出 host 的 public suffix。
 * 規則（節錄自 https://publicsuffix.org/list/）：
 *   1. 所有 rule 由右往左比對；
 *   2. 例外 rule（"!foo.bar"）優先，命中時 suffix = 去掉最左 label；
 *   3. 否則取 label 數最多的 normal / wildcard rule；
 *   4. 沒任何 rule 命中 → 預設 "*" rule（suffix = 最右一個 label）。
 *
 * @param {string[]} labels 已經 lowercased 的 label 陣列
 * @returns {number} suffix 的起始 index（labels[suffixStart..] 即為 public suffix）
 */
function findPublicSuffixStart(labels) {
  let suffixStart = labels.length; // sentinel: 暫定無命中
  for (let i = labels.length - 1; i >= 0; i--) {
    const candidate = labels.slice(i).join(".");
    // 例外規則：命中即直接定案，suffix 比 exception 短一段
    if (PSL_RULES.has("!" + candidate)) {
      return i + 1;
    }
    // 一般規則：精確比對
    if (PSL_RULES.has(candidate)) {
      suffixStart = i; // 繼續往左看，能匹配更長就更長
    }
    // 萬用規則：parent 必須以 "*." rule 存在，且左邊還有 label
    if (i < labels.length - 1) {
      const parent = labels.slice(i + 1).join(".");
      if (PSL_RULES.has("*." + parent)) {
        suffixStart = i;
      }
    }
  }
  // 預設 "*" rule：最右一個 label
  if (suffixStart === labels.length) {
    suffixStart = labels.length - 1;
  }
  return suffixStart;
}

/**
 * 從 URL 抽出 registrable domain（eTLD+1）。
 * 以 Public Suffix List 為準，支援 normal / wildcard / exception rules。
 *
 * @param {string} url 完整 URL 字串
 * @returns {string|null} 小寫 registrable domain；host 為 IP / 純 suffix / 不可解析時回 null
 */
export function extractRootDomain(url) {
  if (!url || typeof url !== "string") return null;

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!host || !host.includes(".")) return null;
  if (isIPv4(host) || isIPv6(host)) return null;

  // 去掉末尾的點（FQDN）
  host = host.replace(/\.$/, "");

  const labels = host.split(".");
  if (labels.length < 2) return null;

  const suffixStart = findPublicSuffixStart(labels);
  // host 本身就是 public suffix（如直接造訪 "co.uk"）→ 無 registrable domain
  if (suffixStart <= 0) return null;

  // registrable = public suffix + 左邊再加一個 label
  return labels.slice(suffixStart - 1).join(".");
}
