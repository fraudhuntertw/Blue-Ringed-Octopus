#!/usr/bin/env python3
"""
Build the bundled allowlist (F5) from CrUX top-site data.

Usage (from repo root):
  python3 scripts/build-allowlist.py [--month YYYYMM] [--skip-165]

Pipeline:
  1. Download CrUX Taiwan country list (rank <= TW_MAX_RANK) and the CrUX
     global list (rank <= GLOBAL_MAX_RANK) for the target month, plus the
     same lists from ~4-5 months earlier, from the zakird/crux-top-lists
     monthly cache (CrUX data: CC BY 4.0 per the Google BigQuery Kaggle
     listing).
  2. Persistence filter: keep only domains present in BOTH months at the
     same rank threshold — kills rotating pirate mirrors, date-stamped
     disposable domains, and freshly manipulated entries.
  3. Normalize origins -> registrable domain (eTLD+1) using scripts/psl.dat
     (labels IDNA-encoded to match URL().hostname's punycode form).
  4. Drop entries under (or equal to) a PSL PRIVATE-section suffix
     (multi-tenant hosting: github.io, blogspot.com, ...).
  5. Drop entries on the extension's own HIGH_RISK_TLDS and TRUSTED_TLDS
     (parsed from lib/lists.js — single source of truth): the former would
     green-light domains we'd otherwise warn about; the latter are dead
     entries (trusted TLDs short-circuit before the allowlist at runtime).
  6. Drop entries matching content-category keywords (adult / pirate
     streaming / file lockers / web proxies / gambling): an orange banner
     on these sites is not a false positive worth suppressing, and a green
     "well-known" badge conflicts with the anti-fraud mission.
  7. Drop entries listed in scripts/allowlist-exclusions.txt (multi-tenant
     hosts missing from PSL, URL shorteners, link-in-bio, form builders,
     named junk that survives the systematic filters).
  8. Merge scripts/tw-seed.txt (hand-curated Taiwan essentials), then drop
     anything present in the 165 anti-fraud suspended-domain list
     (data.gov.tw dataset 176455); a seed hitting the 165 list aborts the
     build. Fails loudly unless --skip-165.
  9. Emit lib/allowlist.js (sorted, escaped, with metadata).

Top lists are manipulable (Le Pochat et al., NDSS 2019) — keep prefixes
small, keep every filter, and never let this list override the blacklist
at runtime.
"""
import argparse
import csv
import datetime
import gzip
import io
import json
import re
import sys
import urllib.error
import urllib.request

TW_MAX_RANK = 5000
GLOBAL_MAX_RANK = 1000
# 持續性過濾:往回幾個月再抓一份,兩個月份都在榜才收。
PERSISTENCE_MONTHS_BACK = [5, 4, 3]

CRUX_TW_URL = "https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/country/tw/{month}.csv.gz"
CRUX_GLOBAL_URL = "https://raw.githubusercontent.com/zakird/crux-top-lists/main/data/global/{month}.csv.gz"
# 165 反詐騙「遭停止解析涉詐網站」(data.gov.tw dataset 176455)
URL_165 = ("https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/"
           "29E8E643-88ED-4952-B21E-BD42A3B7108C/resource/"
           "F7EFE3CD-E117-491D-BE4D-4B64FF6F0CEF/download")

PSL_SRC = "scripts/psl.dat"
LISTS_SRC = "lib/lists.js"
EXCLUSIONS_SRC = "scripts/allowlist-exclusions.txt"
SEED_SRC = "scripts/tw-seed.txt"
DST = "lib/allowlist.js"

# 過濾後總筆數的合理區間 — 超出代表來源結構變了,寧可建置失敗也不要默默出貨壞清單。
SANITY_MIN_TOTAL, SANITY_MAX_TOTAL = 2000, 9000
SANITY_MIN_TW_FILE_ORIGINS = 150_000      # TW 月檔實測約 26 萬 origin
SANITY_MIN_GLOBAL_FILE_ORIGINS = 800_000  # 全球月檔實測約 100 萬 origin
SANITY_MIN_165_DOMAINS = 10_000           # 165 名單實測約 2 萬 eTLD+1
SANITY_MIN_165_PARSE_RATIO = 0.9

MUST_CONTAIN = ["google.com", "youtube.com", "momoshop.com.tw", "shopee.tw", "pchome.com.tw"]
MUST_NOT_CONTAIN = [
    # 每個排除類別至少一個哨兵:PSL PRIVATE / 縮網址 / link-in-bio / 多租戶開店 /
    # 檔案空間 / 子網域託管 / 高風險 TLD
    "blogspot.com", "wixsite.com", "netlify.app",
    "bit.ly", "reurl.cc", "ouo.io",
    "linktr.ee", "heylink.me",
    "1shop.tw", "shoplineapp.com",
    "gofile.io", "fc2.com",
]

# 內容類別過濾（比對整個 eTLD+1 字串）。原則:寧可漏排（殘餘靠人工排除表與
# 文件誠實揭露）,不可誤殺正規網站 —— keyword 必須夠特定。
# 台彩官方 taiwanlottery.com.tw 含 "lotto",故 lotto 不可作裸關鍵字;改列種子豁免。
CATEGORY_PATTERNS = [
    # 成人（特定站名/詞,避免 "sex"/"av" 這類高誤殺裸詞）
    r"porn", r"hentai", r"xnxx", r"xvideo", r"spankbang", r"missav", r"onlyfans",
    r"nhentai", r"hanime", r"18comic", r"javhd", r"jable", r"av01", r"sextb",
    # 盜版影視 / 私服 / 破解（站名族系,輪替域共用字根）
    r"gimy", r"chinaq", r"imaple", r"kubo\d|(\d|^)kubo", r"dramasq", r"pttplay",
    r"olevod", r"olehdtv", r"momovod", r"movierulz", r"filmyzilla", r"filmyfly",
    r"mp4moviez", r"hdhub4u", r"lookmovie", r"goojara", r"skidrow", r"steamunlocked",
    r"igg-games", r"fitgirl", r"futbol-libre", r"lineage\d", r"loalineage",
    # 匿名檔案空間（任意上傳內容）
    r"gofile", r"katfile", r"rapidgator", r"dailyuploads", r"m1xdrop", r"mixdrop",
    r"nitroflare", r"krakenfiles", r"anonfile",
    # 網頁代理（規避偵測的工具,白名單化沒有意義）
    r"croxyproxy", r"proxysite", r"4everproxy",
    # 賭博（特定詞;一般詞如 bet/win 誤殺面太大,殘餘靠人工排除表）
    r"casino", r"baccarat", r"jackpot", r"swin\d|\dswin", r"lotto\d|\dlotto",
]
CATEGORY_RE = re.compile("|".join(f"(?:{p})" for p in CATEGORY_PATTERNS))
# 種子檔網域不受內容類別過濾（官方台彩等會撞 keyword 的正規網站走種子收錄）。


def fetch(url, timeout=120):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BRO-build-allowlist"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError:
        raise  # 404 等 HTTP 錯誤直接外拋（月份探測靠它）,不要落入 curl fallback
    except urllib.error.URLError as err:
        # 部分環境（公司 TLS 代理 / 憑證鏈不完整）urllib 驗不過,退回系統 curl。
        # 鎖定 https（含重導向）,避免在可疑網路環境被降級到明文。
        import subprocess
        print(f"urllib failed ({err.reason}), falling back to curl: {url}", file=sys.stderr)
        proc = subprocess.run(
            ["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https",
             "--max-time", str(timeout), "-A", "BRO-build-allowlist", url],
            capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(
                f"curl failed ({proc.returncode}) for {url}: "
                f"{proc.stderr.decode(errors='replace')[:200]}")
        return proc.stdout


def encode_label(label):
    if all(ord(c) < 128 for c in label):
        return label
    return label.encode("idna").decode("ascii")


def encode_host(host):
    """IDNA-encode each label so Unicode input matches URL().hostname's punycode form."""
    try:
        return ".".join(encode_label(l) for l in host.split(".") if True)
    except UnicodeError:
        return None


def load_psl(path):
    """Return rules dict: rule-string -> is_private."""
    rules = {}
    section_private = False
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "===BEGIN PRIVATE DOMAINS===" in line:
                section_private = True
                continue
            if "===END PRIVATE DOMAINS===" in line:
                section_private = False
                continue
            if not line or line.startswith("//"):
                continue
            rule = ".".join(encode_label(l) for l in line.split("."))
            rules[rule.lower()] = section_private
    return rules


def load_js_set(path, varname):
    """Parse a `const NAME = new Set([ ... ])` string-literal block from lib/lists.js."""
    src = open(path, encoding="utf-8").read()
    m = re.search(rf"const {varname} = new Set\(\[(.*?)\]\)", src, re.DOTALL)
    if not m:
        raise RuntimeError(f"cannot find {varname} in {path}")
    values = re.findall(r'"([^"]+)"', m.group(1))
    if not values:
        raise RuntimeError(f"{varname} parsed empty from {path}")
    return set(values)


def split_registrable(host, rules):
    """Return (registrable_domain, suffix_is_private) per PSL algorithm, or (None, False)."""
    host = encode_host(host.strip().strip("."))
    if not host:
        return None, False
    labels = host.lower().split(".")
    if len(labels) < 2 or "" in labels:
        return None, False
    match_len, match_private, exception = 0, False, None
    for i in range(len(labels)):
        cand = ".".join(labels[i:])
        if "!" + cand in rules:
            exception = (len(labels) - i, rules["!" + cand])
            break
        if cand in rules and (len(labels) - i) > match_len:
            match_len, match_private = len(labels) - i, rules[cand]
        if i + 1 < len(labels):
            wc = "*." + ".".join(labels[i + 1:])
            if wc in rules and (len(labels) - i) > match_len:
                match_len, match_private = len(labels) - i, rules[wc]
    if exception:
        suffix_len, is_private = exception[0] - 1, exception[1]
    elif match_len:
        suffix_len, is_private = match_len, match_private
    else:
        suffix_len, is_private = 1, False  # PSL default rule "*"
    if len(labels) <= suffix_len:
        return None, is_private
    return ".".join(labels[-(suffix_len + 1):]), is_private


def parse_crux_csv(raw_gz, max_rank, min_origins, label):
    rows = 0
    out = []
    with gzip.open(io.BytesIO(raw_gz), mode="rt", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        if header[:2] != ["origin", "rank"]:
            raise RuntimeError(f"unexpected CrUX header in {label}: {header}")
        for row in reader:
            rows += 1
            if int(row[1]) <= max_rank:
                out.append(row[0])
    if rows < min_origins:
        raise RuntimeError(f"{label} has only {rows} origins (< {min_origins}) — source anomaly")
    return out


def origin_to_host(origin):
    m = re.match(r"^https?://([^/:?#]+)", origin)
    return m.group(1).lower() if m else None


def clean_165_value(raw):
    """165 名單的網域欄有少量髒值（'?xxx.top'、'host/path'）,清理成裸 host。"""
    v = raw.strip().lower().lstrip("?")
    v = re.sub(r"^https?://", "", v)
    return v.split("/")[0].split("#")[0].split("?")[0]


def read_list_file(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            d = line.split("#")[0].strip().lower()
            if d:
                out.append(d)
    return out


def fetch_month_walk(url_tpl, months, label):
    for m in months:
        try:
            return fetch(url_tpl.format(month=m)), m
        except (urllib.error.HTTPError, RuntimeError):
            continue
    raise RuntimeError(f"{label} not found for any of months {months}")


def months_back(yyyymm, n):
    d = datetime.date(int(yyyymm[:4]), int(yyyymm[4:6]), 1)
    for _ in range(n):
        d = (d.replace(day=1) - datetime.timedelta(days=1)).replace(day=1)
    return f"{d.year}{d.month:02d}"


def origins_to_domains(origins, rules):
    """origin 列表 → (eTLD+1 集合, 被 PRIVATE 後綴剔除數)"""
    domains, dropped_private = set(), 0
    for origin in origins:
        host = origin_to_host(origin)
        if not host or re.fullmatch(r"[0-9.]+", host):
            continue
        registrable, is_private = split_registrable(host, rules)
        if registrable is None or is_private:
            dropped_private += 1
            continue
        domains.add(registrable)
    return domains, dropped_private


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", help="CrUX month, e.g. 202605 (default: newest available)")
    ap.add_argument("--skip-165", action="store_true",
                    help="skip the 165 suspended-domain intersection filter")
    args = ap.parse_args()

    rules = load_psl(PSL_SRC)
    high_risk_tlds = load_js_set(LISTS_SRC, "HIGH_RISK_TLDS")
    trusted_tlds = load_js_set(LISTS_SRC, "TRUSTED_TLDS")
    print(f"PSL rules: {len(rules)}; high-risk TLDs: {len(high_risk_tlds)}; trusted TLDs: {len(trusted_tlds)}")

    # --- 取得目標月份（current）與持續性比對月份（old） ---
    if args.month:
        candidates = [args.month]
    else:
        d = datetime.date.today()
        candidates = []
        for _ in range(6):
            candidates.append(f"{d.year}{d.month:02d}")
            d = (d.replace(day=1) - datetime.timedelta(days=1))
    tw_raw, tw_month = fetch_month_walk(CRUX_TW_URL, candidates, "CrUX TW")
    old_candidates = [months_back(tw_month, n) for n in PERSISTENCE_MONTHS_BACK]
    tw_old_raw, tw_old_month = fetch_month_walk(CRUX_TW_URL, old_candidates, "CrUX TW (persistence)")

    tw_origins = parse_crux_csv(tw_raw, TW_MAX_RANK, SANITY_MIN_TW_FILE_ORIGINS, f"TW {tw_month}")
    tw_old_origins = parse_crux_csv(tw_old_raw, TW_MAX_RANK, SANITY_MIN_TW_FILE_ORIGINS, f"TW {tw_old_month}")
    print(f"CrUX TW {tw_month}: rank<={TW_MAX_RANK}: {len(tw_origins)}; persistence month {tw_old_month}: {len(tw_old_origins)}")

    g_raw, g_month = fetch_month_walk(CRUX_GLOBAL_URL, [tw_month] + candidates, "CrUX global")
    g_old_raw, g_old_month = fetch_month_walk(CRUX_GLOBAL_URL, [tw_old_month] + old_candidates, "CrUX global (persistence)")
    g_origins = parse_crux_csv(g_raw, GLOBAL_MAX_RANK, SANITY_MIN_GLOBAL_FILE_ORIGINS, f"global {g_month}")
    g_old_origins = parse_crux_csv(g_old_raw, GLOBAL_MAX_RANK, SANITY_MIN_GLOBAL_FILE_ORIGINS, f"global {g_old_month}")
    print(f"CrUX global {g_month}: rank<={GLOBAL_MAX_RANK}: {len(g_origins)}; persistence month {g_old_month}: {len(g_old_origins)}")

    # --- origin → eTLD+1（含 PSL PRIVATE 剔除）,再做跨月持續性交集 ---
    cur_domains, dropped_private = origins_to_domains(tw_origins + g_origins, rules)
    old_domains, _ = origins_to_domains(tw_old_origins + g_old_origins, rules)
    domains = cur_domains & old_domains
    print(f"eTLD+1: current {len(cur_domains)} (dropped {dropped_private} private) ∩ "
          f"{tw_old_month} {len(old_domains)} → persistent {len(domains)} "
          f"(churn dropped {len(cur_domains) - len(domains)})")

    # --- 自家高風險 TLD / 可信 TLD 剔除 ---
    def tld_of(d):
        return d.rsplit(".", 1)[-1]
    def trusted_suffix(d):
        parts = d.split(".")
        return len(parts) >= 2 and ".".join(parts[-2:]) in trusted_tlds
    hr_dropped = sorted(d for d in domains if tld_of(d) in high_risk_tlds)
    domains -= set(hr_dropped)
    tr_dropped = [d for d in domains if trusted_suffix(d)]
    domains -= set(tr_dropped)
    print(f"high-risk TLD dropped: {len(hr_dropped)}" + (f" -> {hr_dropped[:10]}…" if hr_dropped else ""))
    print(f"trusted TLD (dead entries) dropped: {len(tr_dropped)}")

    # --- 內容類別過濾 ---
    cat_dropped = sorted(d for d in domains if CATEGORY_RE.search(d))
    domains -= set(cat_dropped)
    print(f"category dropped: {len(cat_dropped)} -> {cat_dropped}")

    # --- 人工排除表（驗證每行;未命中者提示） ---
    exclusions = read_list_file(EXCLUSIONS_SRC)
    bad_excl = []
    for e in exclusions:
        reg, priv = split_registrable(e, rules)
        if reg == e:
            continue  # 乾淨 eTLD+1
        if reg is None and priv:
            continue  # 本身已是 PSL PRIVATE 後綴 —— 冗餘但無害（PSL 收錄後仍保留防回歸）
        bad_excl.append(e)
    if bad_excl:
        raise RuntimeError(f"exclusion entries not clean eTLD+1 (typo? subdomain?): {bad_excl}")
    excl_set = set(exclusions)
    excl_hit = domains & excl_set
    domains -= excl_set
    print(f"exclusions removed: {len(excl_hit)} "
          f"({len(excl_set) - len(excl_hit)} entries not present this month, kept for future)")

    # --- 台灣人工種子（在 165 過濾「之前」併入 —— 種子也要受 165 檢查） ---
    seeds = read_list_file(SEED_SRC)
    bad_seeds = [s for s in seeds
                 if s in excl_set
                 or split_registrable(s, rules) != (s, False)
                 or tld_of(s) in high_risk_tlds
                 or trusted_suffix(s)]
    if bad_seeds:
        raise RuntimeError(f"seed entries invalid (not clean public eTLD+1 / excluded / high-risk / trusted): {bad_seeds}")
    domains |= set(seeds)
    print(f"seeds merged: {len(seeds)}")

    # --- 165 涉詐名單交集剔除 ---
    meta_165 = {"applied": False}
    if args.skip_165:
        print("WARNING: skipping 165 filter (--skip-165)")
    else:
        raw = fetch(URL_165).decode("utf-8-sig", errors="replace")
        rows = list(csv.reader(io.StringIO(raw)))
        if len(rows) < 100 or "網域" not in rows[0]:
            raise RuntimeError(f"165 CSV unexpected format: header={rows[0] if rows else None}")
        col = rows[0].index("網域")
        flagged, unparsed = set(), 0
        for row in rows[1:]:
            if len(row) <= col or not row[col].strip():
                continue
            reg, _ = split_registrable(clean_165_value(row[col]), rules)
            if reg:
                flagged.add(reg)
            else:
                unparsed += 1
        if len(flagged) < SANITY_MIN_165_DOMAINS:
            raise RuntimeError(f"165 list parsed only {len(flagged)} domains — format change?")
        if len(flagged) / max(1, len(flagged) + unparsed) < SANITY_MIN_165_PARSE_RATIO:
            raise RuntimeError(f"165 list parse ratio too low ({unparsed} unparsed) — format change?")
        seed_hits = set(seeds) & flagged
        if seed_hits:
            # 種子被 165 點名是建置失敗等級的事件（種子可能過期被搶註）。
            raise RuntimeError(f"SEED DOMAINS ON 165 LIST — investigate before shipping: {sorted(seed_hits)}")
        hit = domains & flagged
        domains -= flagged
        meta_165 = {"applied": True, "fetchedAt": datetime.date.today().isoformat(),
                    "flaggedCount": len(flagged), "removed": sorted(hit)}
        print(f"165 list: {len(flagged)} domains ({unparsed} unparsed), intersection removed: {len(hit)}"
              + (f" -> {sorted(hit)}" if hit else ""))

    # --- 健檢 ---
    if not (SANITY_MIN_TOTAL <= len(domains) <= SANITY_MAX_TOTAL):
        raise RuntimeError(f"final count {len(domains)} outside [{SANITY_MIN_TOTAL}, {SANITY_MAX_TOTAL}]")
    missing = [d for d in MUST_CONTAIN if d not in domains]
    leaked = [d for d in MUST_NOT_CONTAIN if d in domains]
    bad_chars = [d for d in domains if not re.fullmatch(r"[a-z0-9.-]+", d)]
    hr_leak = [d for d in domains if tld_of(d) in high_risk_tlds]
    if missing or leaked or bad_chars or hr_leak:
        raise RuntimeError(f"sanity failed — missing: {missing}, leaked: {leaked}, "
                           f"bad chars: {bad_chars[:5]}, high-risk leak: {hr_leak[:5]}")

    # --- 輸出 ---
    sorted_domains = sorted(domains)
    meta = {
        "twMonth": tw_month,
        "globalMonth": g_month,
        "persistenceMonth": tw_old_month,
        "twMaxRank": TW_MAX_RANK,
        "globalMaxRank": GLOBAL_MAX_RANK,
        "count": len(sorted_domains),
        "filter165": meta_165,
        "generatedAt": datetime.date.today().isoformat(),
        # 選項頁顯示用（沿用既有鍵名）
        "sourceMonth": tw_month,
    }
    with open(DST, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED by scripts/build-allowlist.py — DO NOT EDIT BY HAND.\n")
        f.write("// 內建白名單（F5）:CrUX（Chrome UX Report,CC BY 4.0,取自 zakird/crux-top-lists\n")
        f.write(f"// 月更快取）台灣國別清單 rank<={TW_MAX_RANK} + 全球清單 rank<={GLOBAL_MAX_RANK}。\n")
        f.write("// 過濾:跨月持續性交集（殺輪替/拋棄式域名）、PSL PRIVATE 區段、自家高風險 TLD、\n")
        f.write("// 可信 TLD 死條目、內容類別（成人/盜版/檔案空間/代理/賭博）、人工排除表、\n")
        f.write("// 165 涉詐停止解析名單交集;並併入 scripts/tw-seed.txt 人工種子。\n")
        f.write("// 注意:「在榜」代表真實流量與穩定性,不是品質背書;命中時放行且跳過啟發式偵測。\n")
        f.write("// 重建:python3 scripts/build-allowlist.py（CrUX 每月第二個週二後更新）\n")
        f.write(f"export const ALLOWLIST_META = {json.dumps(meta, ensure_ascii=False)};\n\n")
        f.write("export const ALLOWLIST = [\n")
        for d in sorted_domains:
            f.write(f"  {json.dumps(d)},\n")
        f.write("];\n")
    print(f"wrote {DST}: {len(sorted_domains)} domains "
          f"(tw={tw_month}, global={g_month}, persistence={tw_old_month})")


if __name__ == "__main__":
    sys.exit(main())
