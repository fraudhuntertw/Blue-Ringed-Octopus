/**
 * 子網域品牌偽裝偵測（F8a）。
 *
 * 針對的詐騙型態：把知名品牌字樣塞進「子網域」,讓網址看起來像官方網站,
 * 例如 paypal.com.evil.xyz、www.shopee.tw.promo-event.top —— eTLD+1 其實是
 * evil.xyz / promo-event.top,與品牌毫無關係。這類網站常用成熟的 .com 網域
 * （年齡訊號抓不到）且不在任何名單上,是 eTLD+1 視角的最大偵測缺口。
 *
 * 偵測規則（純本地、零外送）：
 *   - 只看「子網域部分」的 label（hostname 去掉 eTLD+1 後逐段比對）,
 *     eTLD+1 本身不檢查（那是 typosquat / F6 的範圍）。
 *   - label 與品牌 token「整段完全相等」才算命中 —— 不做子字串比對,
 *     避免 online.example.com 之類誤殺。
 *   - eTLD+1 在該品牌的官方網域清單內 → 一律不標（自家子網域天然合法,
 *     例如 paypal.community.paypal.com）。
 *   - bare:false 的 token 是一般詞彙（line / apple / momo…）,單獨出現誤殺
 *     風險高（line.某公司.com.tw 常是合法的 LINE 導流頁）,因此額外要求
 *     「域名仿冒語境」：token 右側緊跟著偽 TLD label（line.me.evil.xyz、
 *     apple.com.evil.top）才命中。bare:true 的 token 是獨創詞,單獨出現
 *     即可命中。
 *   - punycode（xn--）label 是 ASCII 編碼,不會與 token 相等,自然略過
 *     （homograph 偵測屬 F7 範圍）。
 *
 * 免費託管平台不會誤殺：brand.github.io 這類網域經 PSL PRIVATE 區段解析後
 * eTLD+1 就是 brand.github.io 本身,沒有「子網域部分」可比對。
 */

// 非 bare token 的「域名仿冒語境」：token 右側緊跟其一,才視為在假冒完整網址。
const PSEUDO_TLD_LABELS = new Set([
  "com", "net", "org", "tw", "co", "cc", "me", "jp", "hk", "cn", "io", "app",
]);

// 已知「子網域屬不同租戶」的連結 / 代理服務根網域（不在 PSL PRIVATE 區段,
// 否則 extractRootDomain 就處理掉了）。這些服務把子網域配發給品牌本人:
// shopee.onelink.me / momoshop.onelink.me 是品牌官方簡訊裡的 App 連結,
// 偵測它們等於在長輩最常點的官方動線上誤殺。mcas.ms / cas.ms 是
// Microsoft Defender for Cloud Apps 的 URL 重寫代理,host 內天然夾帶原站字樣。
const SUBDOMAIN_PROVIDER_ROOTS = new Set([
  "onelink.me",   // AppsFlyer OneLink
  "adj.st",       // Adjust
  "mcas.ms",      // Microsoft Defender for Cloud Apps 代理
  "cas.ms",
]);

/**
 * 內建常被冒用品牌 → 官方網域對照表。
 *
 * 收錄準則：台灣釣魚簡訊 / LINE 詐騙最常冒用的本地金融、購物、繳費、
 * 電信、政府服務,加上全球高價值帳號類品牌。token 一律小寫 ASCII;
 * official 一律 eTLD+1（與 extractRootDomain 口徑一致）。
 * bare:true = 獨創詞,單獨成 label 即命中;bare:false = 一般詞,需仿冒語境。
 *
 * 要新增或移除請編輯此陣列,選項頁清單、popup 與橫幅會自動反映。
 */
export const BRAND_RULES = [
  // === 全球高價值帳號 ===
  { brand: "PayPal", tokens: ["paypal"], official: ["paypal.com", "paypal.me"], bare: true },
  { brand: "Google", tokens: ["google", "gmail", "youtube"], official: ["google.com", "google.com.tw", "gmail.com", "youtube.com", "googleapis.com", "googleusercontent.com", "googleblog.com"], bare: true },
  { brand: "Facebook", tokens: ["facebook"], official: ["facebook.com", "fb.com", "fbcdn.net", "meta.com"], bare: true },
  { brand: "Instagram", tokens: ["instagram"], official: ["instagram.com", "cdninstagram.com", "meta.com"], bare: true },
  { brand: "WhatsApp", tokens: ["whatsapp"], official: ["whatsapp.com", "whatsapp.net", "meta.com"], bare: true },
  { brand: "Apple", tokens: ["apple"], official: ["apple.com", "icloud.com"], bare: false },
  { brand: "iCloud", tokens: ["icloud"], official: ["icloud.com", "apple.com"], bare: true },
  { brand: "Microsoft", tokens: ["microsoft", "outlook"], official: ["microsoft.com", "outlook.com", "live.com", "office.com", "office365.com", "microsoft365.com", "microsoftonline.com", "sharepoint.com", "cloud.microsoft"], bare: true },
  { brand: "Amazon", tokens: ["amazon"], official: ["amazon.com", "amazon.co.jp", "amazonaws.com"], bare: true },
  { brand: "Netflix", tokens: ["netflix"], official: ["netflix.com", "nflxext.com"], bare: true },
  { brand: "Booking.com", tokens: ["booking"], official: ["booking.com"], bare: false },
  { brand: "Agoda", tokens: ["agoda"], official: ["agoda.com"], bare: true },

  // === LINE（台灣詐騙最常冒用,但 token 是一般詞 → 需仿冒語境）===
  { brand: "LINE", tokens: ["line"], official: ["line.me", "lin.ee", "line-apps.com", "line-scdn.net", "linecorp.com"], bare: false },

  // === 台灣購物 / 金流 ===
  { brand: "蝦皮購物", tokens: ["shopee"], official: ["shopee.tw", "shopee.com", "shopeemobile.com"], bare: true },
  { brand: "momo購物網", tokens: ["momoshop"], official: ["momoshop.com.tw"], bare: true },
  { brand: "momo購物網", tokens: ["momo"], official: ["momoshop.com.tw", "momo.dm"], bare: false },
  { brand: "PChome", tokens: ["pchome"], official: ["pchome.com.tw", "pchome24h.com.tw", "megatime.com.tw"], bare: true },
  { brand: "露天市集", tokens: ["ruten"], official: ["ruten.com.tw"], bare: true },
  { brand: "街口支付", tokens: ["jkopay"], official: ["jkopay.com"], bare: true },
  { brand: "悠遊卡", tokens: ["easycard"], official: ["easycard.com.tw"], bare: true },
  { brand: "綠界科技", tokens: ["ecpay"], official: ["ecpay.com.tw"], bare: true },
  { brand: "藍新金流", tokens: ["newebpay"], official: ["newebpay.com", "ezpay.com.tw"], bare: true },

  // === 台灣銀行 / 證券 ===
  { brand: "中國信託", tokens: ["ctbc", "ctbcbank"], official: ["ctbcbank.com", "ctbcholding.com"], bare: true },
  { brand: "國泰世華", tokens: ["cathaybk"], official: ["cathaybk.com.tw"], bare: true },
  { brand: "國泰", tokens: ["cathay"], official: ["cathaybk.com.tw", "cathayholdings.com", "cathaysec.com.tw", "cathaypacific.com"], bare: false },
  { brand: "玉山銀行", tokens: ["esun", "esunbank"], official: ["esunbank.com.tw", "esunbank.com", "esunfhc.com"], bare: true },
  { brand: "富邦", tokens: ["fubon"], official: ["fubon.com"], bare: true },
  { brand: "台新銀行", tokens: ["taishin"], official: ["taishinbank.com.tw", "tsholdings.com.tw", "richart.tw"], bare: true },
  { brand: "兆豐銀行", tokens: ["megabank"], official: ["megabank.com.tw"], bare: true },
  { brand: "第一銀行", tokens: ["firstbank"], official: ["firstbank.com.tw"], bare: true },
  { brand: "土地銀行", tokens: ["landbank"], official: ["landbank.com.tw"], bare: true },
  { brand: "華南銀行", tokens: ["hncb"], official: ["hncb.com.tw"], bare: true },
  { brand: "永豐銀行", tokens: ["sinopac"], official: ["sinopac.com"], bare: true },
  { brand: "元大", tokens: ["yuanta"], official: ["yuanta.com", "yuanta.com.tw"], bare: true },

  // === 台灣電信 / 公用事業 / 交通 ===
  { brand: "中華電信", tokens: ["hinet"], official: ["hinet.net", "cht.com.tw"], bare: true },
  { brand: "中華電信", tokens: ["cht"], official: ["cht.com.tw", "hinet.net"], bare: false },
  { brand: "台灣電力", tokens: ["taipower"], official: ["taipower.com.tw"], bare: true },
  { brand: "監理服務網", tokens: ["mvdis"], official: ["mvdis.gov.tw"], bare: true },
  { brand: "台灣高鐵", tokens: ["thsrc"], official: ["thsrc.com.tw"], bare: true },

  // === 台灣零售 ===
  { brand: "全聯", tokens: ["pxmart"], official: ["pxmart.com.tw", "pxpayplus.com"], bare: true },
  { brand: "家樂福", tokens: ["carrefour"], official: ["carrefour.com.tw", "carrefour.com"], bare: true },
  { brand: "7-ELEVEN ibon", tokens: ["ibon"], official: ["ibon.com.tw"], bare: true },
];

/**
 * 檢查 hostname 的「子網域部分」是否夾帶品牌 token（品牌偽裝）。
 *
 * @param {string|null|undefined} hostname 完整 host（如 "paypal.com.evil.xyz"）
 * @param {string|null|undefined} rootDomain 該 host 的 registrable domain（eTLD+1,如 "evil.xyz"）
 * @returns {{ brand: string, token: string, official: string }|null}
 *          official 是該品牌的主要官方網域（清單第一項,供告警文案顯示）
 */
export function findBrandSpoof(hostname, rootDomain) {
  if (!hostname || !rootDomain || typeof hostname !== "string" || typeof rootDomain !== "string") {
    return null;
  }
  const h = hostname.toLowerCase().replace(/\.$/, "");
  // 沒有子網域部分（host 即 eTLD+1）→ 無從偽裝
  if (h === rootDomain || !h.endsWith("." + rootDomain)) return null;
  // 子網域屬不同租戶的連結 / 代理服務:子網域是品牌本人（或代理重寫）,不偵測
  if (SUBDOMAIN_PROVIDER_ROOTS.has(rootDomain)) return null;
  const labels = h.slice(0, -(rootDomain.length + 1)).split(".");
  // token 右側（往 eTLD+1 方向）的下一個 label:token 是子網域最末段時,
  // 下一段就是 eTLD+1 的第一個 label —— apple.com.xyz（root=com.xyz）的
  // 「com」語境在 root 裡,漏看會讓非 bare 品牌對最典型的
  // brand.<偽TLD>.<真TLD> 形態漏報。
  const rootFirstLabel = rootDomain.split(".")[0];

  for (const rule of BRAND_RULES) {
    // 自家官方網域的子網域天然合法,不標
    if (rule.official.includes(rootDomain)) continue;
    for (let i = 0; i < labels.length; i++) {
      if (!rule.tokens.includes(labels[i])) continue;
      const next = i + 1 < labels.length ? labels[i + 1] : rootFirstLabel;
      if (rule.bare || PSEUDO_TLD_LABELS.has(next)) {
        return { brand: rule.brand, token: labels[i], official: rule.official[0] };
      }
    }
  }
  return null;
}

/**
 * 取得內建品牌清單（給選項頁 / popup 顯示用）。
 * @returns {{brand: string, official: string}[]} 去重後的品牌 → 主要官方網域
 */
export function getBrandList() {
  const seen = new Set();
  const out = [];
  for (const rule of BRAND_RULES) {
    if (seen.has(rule.brand)) continue;
    seen.add(rule.brand);
    out.push({ brand: rule.brand, official: rule.official[0] });
  }
  return out;
}
