/**
 * Options 頁邏輯：
 *   - 白名單 / 黑名單 CRUD
 *   - 告警門檻設定
 *   - 清除查詢快取
 *   - 顯示內建可信 TLD / 高風險 TLD / 高風險註冊商 清單
 */

import {
  initI18n, applyI18n, t,
  getCurrentLocale, setPreferredLocale,
  SUPPORTED_LOCALES,
} from "../lib/i18n.js";

const $ = (id) => document.getElementById(id);

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("[BRO options] sendMessage error:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(resp);
    });
  });
}

// === 白名單 / 黑名單 ===

function renderListInto(ulId, list, removeType) {
  const ul = $(ulId);
  ul.innerHTML = "";
  if (!list || list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "list-empty";
    empty.textContent = t("listEmpty");
    ul.appendChild(empty);
    return;
  }
  for (const domain of list) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = domain;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "remove-btn";
    btn.textContent = t("btnRemove");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await sendMessage({ type: removeType, domain });
      await refreshLists();
    });
    li.appendChild(name);
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

async function refreshLists() {
  const [wl, bl] = await Promise.all([
    sendMessage({ type: "GET_WHITELIST" }),
    sendMessage({ type: "GET_BLACKLIST" }),
  ]);
  const wlist = (wl && wl.list) || [];
  const blist = (bl && bl.list) || [];
  $("wl-count").textContent = `(${wlist.length})`;
  $("bl-count").textContent = `(${blist.length})`;
  renderListInto("whitelist", wlist, "REMOVE_WHITELIST");
  renderListInto("blacklist", blist, "REMOVE_BLACKLIST");
}

async function wireAddInput(inputId, btnId, msgType) {
  async function doAdd() {
    const input = $(inputId);
    const v = input.value.trim();
    if (!v) return;
    const resp = await sendMessage({ type: msgType, domain: v });
    // 名單存入會化約成 eTLD+1;IP / 單段 host / 無法解析 → background 回 invalid,
    // 顯示錯誤而非默默吞掉（否則使用者以為加好了,實際永遠比對不到）。
    if (resp && resp.ok === false) {
      input.setCustomValidity(t("addDomainInvalid"));
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    input.value = "";
    await refreshLists();
  }
  $(btnId).addEventListener("click", doAdd);
  $(inputId).addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doAdd();
    }
  });
  $(inputId).addEventListener("input", () => $(inputId).setCustomValidity(""));
}

wireAddInput("wl-input", "wl-add", "ADD_WHITELIST");
wireAddInput("bl-input", "bl-add", "ADD_BLACKLIST");

// === 語言切換 ===

function initLanguageSelector() {
  const sel = $("lang-select");
  sel.value = getCurrentLocale();
  sel.addEventListener("change", async (e) => {
    sel.disabled = true;
    const ok = await setPreferredLocale(e.target.value);
    if (ok) {
      // 重新整理就好,所有節點重 render 太囉嗦
      location.reload();
    } else {
      sel.disabled = false;
      sel.value = getCurrentLocale();
    }
  });
}

// === 黑名單批次匯入 ===

function parseBatchDomains(raw) {
  // 一行一個 或 逗號分隔；# 開頭視為註解；trim 空白
  const out = [];
  const seen = new Set();
  for (const line of String(raw || "").split(/\r?\n/)) {
    const stripped = line.split("#")[0]; // 去掉行內註解
    for (const part of stripped.split(/[,;\s]+/)) {
      const d = part.trim().toLowerCase().replace(/^\.+|\.+$/g, "");
      if (!d) continue;
      // 簡單檢核：至少含一個點、無空白、合法字元
      if (!/^[a-z0-9.-]+$/.test(d) || !d.includes(".")) continue;
      if (seen.has(d)) continue;
      seen.add(d);
      out.push(d);
    }
  }
  return out;
}

async function doBatchAddBlacklist() {
  const ta = $("bl-batch-input");
  const info = $("bl-batch-info");
  const btn = $("bl-batch-add");
  const domains = parseBatchDomains(ta.value);

  if (domains.length === 0) {
    info.textContent = t("batchNoValid");
    info.className = "settings-info is-error";
    return;
  }

  btn.disabled = true;
  info.textContent = t("batchProcessing", 0, domains.length);
  info.className = "settings-info";

  let added = 0;
  let dup = 0;
  let fail = 0;
  const failedDomains = [];
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    const resp = await sendMessage({ type: "ADD_BLACKLIST", domain: d });
    if (!resp || resp.ok === false) {
      fail++;
      failedDomains.push(d);
    } else if (resp.alreadyExists) {
      dup++;
    } else {
      added++;
    }
    if ((i + 1) % 10 === 0 || i === domains.length - 1) {
      info.textContent = t("batchProcessing", i + 1, domains.length);
    }
  }

  await refreshLists();
  btn.disabled = false;
  // 有失敗項目時保留在輸入框供使用者修正後重試,並用紅色錯誤樣式提示;否則清空。
  ta.value = failedDomains.join("\n");

  const parts = [t("batchAdded", added)];
  if (dup > 0) parts.push(t("batchDuplicate", dup));
  if (fail > 0) parts.push(t("batchFailed", fail));
  info.textContent = parts.join(" / ");
  info.className = fail > 0 ? "settings-info is-error" : "settings-info is-saved";
}

$("bl-batch-add").addEventListener("click", doBatchAddBlacklist);

// === 內建清單 ===

async function loadTrustedTlds() {
  const resp = await sendMessage({ type: "GET_TRUSTED_TLDS" });
  const list = (resp && resp.list) || [];
  $("trusted-count").textContent = `(${list.length})`;
  const container = $("trusted-list");
  container.innerHTML = "";
  for (const tld of list) {
    const span = document.createElement("span");
    span.className = "tld";
    span.textContent = `.${tld}`;
    container.appendChild(span);
  }
}

async function loadHighRiskTlds() {
  const resp = await sendMessage({ type: "GET_HIGH_RISK_TLDS_DETAIL" });
  const builtin = (resp && Array.isArray(resp.builtin)) ? resp.builtin : [];
  const userAdded = (resp && Array.isArray(resp.userAdded)) ? resp.userAdded : [];

  // 有效清單：內建（未停用）+ 使用者新增
  const activeBuiltin = builtin.filter(b => !b.disabled);
  const disabledBuiltin = builtin.filter(b => b.disabled);
  const activeCount = activeBuiltin.length + userAdded.length;

  $("tld-count").textContent = `(${activeCount})`;

  const container = $("tld-list");
  container.innerHTML = "";

  // 先畫使用者自訂（紅底，方便辨識）
  for (const tld of userAdded) {
    container.appendChild(makeTldChip(tld, "user"));
  }
  // 再畫內建
  for (const b of activeBuiltin) {
    container.appendChild(makeTldChip(b.tld, "builtin"));
  }

  // 停用清單區塊
  const disabledWrap = $("tld-disabled-wrap");
  $("tld-disabled-count").textContent = `(${disabledBuiltin.length})`;
  if (disabledBuiltin.length === 0) {
    disabledWrap.hidden = true;
  } else {
    disabledWrap.hidden = false;
    const dl = $("tld-disabled-list");
    dl.innerHTML = "";
    for (const b of disabledBuiltin) {
      dl.appendChild(makeTldChip(b.tld, "disabled"));
    }
  }
}

function makeTldChip(tld, kind /* "builtin" | "user" | "disabled" */) {
  const chip = document.createElement("span");
  chip.className = "tld-chip";
  if (kind === "user") chip.classList.add("tld-chip-user");

  const label = document.createElement("span");
  label.textContent = `.${tld}`;
  chip.appendChild(label);

  // 內建（active）不加 badge — 預設狀態，加了反而吵
  if (kind !== "builtin") {
    const origin = document.createElement("span");
    origin.className = "tld-origin";
    origin.textContent = kind === "user" ? t("chipOriginUser") : t("chipOriginDisabled");
    chip.appendChild(origin);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tld-action";
  if (kind === "disabled") {
    btn.textContent = "↻";
    btn.title = t("chipTitleRestore");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await sendMessage({ type: "ADD_HIGH_RISK_TLD", tld });
      await loadHighRiskTlds();
    });
  } else {
    btn.textContent = "✕";
    btn.title = kind === "user" ? t("chipTitleRemoveUser") : t("chipTitleDisableBuiltin");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await sendMessage({ type: "REMOVE_HIGH_RISK_TLD", tld });
      await loadHighRiskTlds();
    });
  }
  chip.appendChild(btn);

  return chip;
}

async function doAddHighRiskTld() {
  const input = $("tld-input");
  const v = input.value.trim();
  if (!v) return;
  const resp = await sendMessage({ type: "ADD_HIGH_RISK_TLD", tld: v });
  if (resp && resp.ok === false) {
    input.setCustomValidity(t("addTldFailed", resp.reason || t("unknownError")));
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  input.value = "";
  await loadHighRiskTlds();
}

$("tld-add").addEventListener("click", doAddHighRiskTld);
$("tld-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    doAddHighRiskTld();
  }
});
$("tld-input").addEventListener("input", () => {
  $("tld-input").setCustomValidity("");
});

async function loadHighRiskRegistrars() {
  const resp = await sendMessage({ type: "GET_HIGH_RISK_REGISTRARS" });
  const list = (resp && resp.list) || [];
  $("registrar-count").textContent = `(${list.length})`;
  const container = $("registrar-list");
  container.innerHTML = "";
  for (const name of list) {
    const span = document.createElement("span");
    span.className = "tld";
    span.textContent = name;
    container.appendChild(span);
  }
}

// === 告警門檻 ===

let thresholdMeta = { default: 30, min: 1, max: 3650 };

async function loadThreshold() {
  const resp = await sendMessage({ type: "GET_THRESHOLD" });
  if (!resp || typeof resp.value !== "number") return;
  if (resp.meta) thresholdMeta = resp.meta;
  const input = $("threshold-input");
  input.min = thresholdMeta.min;
  input.max = thresholdMeta.max;
  input.value = resp.value;
  setThresholdInfo(
    resp.value === thresholdMeta.default
      ? t("thresholdDefault", thresholdMeta.default)
      : t("thresholdCustom", thresholdMeta.default),
    null
  );
}

function setThresholdInfo(text, status /* "saved" | "error" | null */) {
  const el = $("threshold-info");
  el.textContent = text;
  el.className = "settings-info";
  if (status === "saved") el.classList.add("is-saved");
  if (status === "error") el.classList.add("is-error");
}

async function saveThreshold() {
  const input = $("threshold-input");
  const n = parseInt(input.value, 10);
  if (!Number.isFinite(n)) {
    setThresholdInfo(t("thresholdInvalid"), "error");
    return;
  }
  if (n < thresholdMeta.min || n > thresholdMeta.max) {
    setThresholdInfo(t("thresholdOutOfRange", thresholdMeta.min, thresholdMeta.max), "error");
    return;
  }
  const btn = $("threshold-save");
  btn.disabled = true;
  const resp = await sendMessage({ type: "SET_THRESHOLD", days: n });
  btn.disabled = false;
  if (resp && resp.ok) {
    setThresholdInfo(t("thresholdSaved", resp.value), "saved");
  } else {
    setThresholdInfo(t("saveFailed", (resp && resp.error) || t("unknownError")), "error");
  }
}

$("threshold-save").addEventListener("click", saveThreshold);
$("threshold-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveThreshold();
  }
});

// === 加強告警（蓋版）開關 ===

function setOverlayInfo(text, status /* "saved" | "error" | null */) {
  const el = $("overlay-info");
  el.textContent = text;
  el.className = "settings-info";
  if (status === "saved") el.classList.add("is-saved");
  if (status === "error") el.classList.add("is-error");
}

async function loadOverlayToggles() {
  const resp = await sendMessage({ type: "GET_OVERLAY_FLAGS" });
  const flags = (resp && resp.flags) || { blacklist: true, young: false, highRiskTld: false };
  $("overlay-blacklist").checked = !!flags.blacklist;
  $("overlay-young").checked = !!flags.young;
  $("overlay-high-risk-tld").checked = !!flags.highRiskTld;
  setOverlayInfo(
    flags.blacklist || flags.young || flags.highRiskTld ? t("overlayEnabled") : t("overlayDisabled"),
    null
  );
}

async function saveOverlayFlag(checkboxId, msgType, labelKey) {
  const value = $(checkboxId).checked;
  const resp = await sendMessage({ type: msgType, value });
  if (resp && resp.ok) {
    setOverlayInfo(t("overlayFlagSaved", t(labelKey), t(value ? "labelOn" : "labelOff")), "saved");
  } else {
    setOverlayInfo(t("saveFailed", (resp && resp.error) || t("unknownError")), "error");
    // 回滾畫面狀態
    $(checkboxId).checked = !value;
  }
}

$("overlay-blacklist").addEventListener("change", () => {
  saveOverlayFlag("overlay-blacklist", "SET_OVERLAY_BLACKLIST", "overlayBlacklistShortLabel");
});
$("overlay-young").addEventListener("change", () => {
  saveOverlayFlag("overlay-young", "SET_OVERLAY_YOUNG", "overlayYoungShortLabel");
});
$("overlay-high-risk-tld").addEventListener("change", () => {
  saveOverlayFlag("overlay-high-risk-tld", "SET_OVERLAY_HIGH_RISK_TLD", "overlayHighRiskTldShortLabel");
});

// === 鎖定告警（無法忽略）開關 ===

function setLockInfo(text, status /* "saved" | "error" | null */) {
  const el = $("lock-info");
  el.textContent = text;
  el.className = "settings-info";
  if (status === "saved") el.classList.add("is-saved");
  if (status === "error") el.classList.add("is-error");
}

async function loadLockToggles() {
  const resp = await sendMessage({ type: "GET_LOCK_FLAGS" });
  const flags = (resp && resp.flags) || { blacklist: false, young: false };
  $("lock-blacklist").checked = !!flags.blacklist;
  $("lock-young").checked = !!flags.young;
  setLockInfo(
    flags.blacklist || flags.young ? t("lockEnabled") : t("lockDisabled"),
    null
  );
}

async function saveLockFlag(checkboxId, msgType, labelKey) {
  const value = $(checkboxId).checked;
  const resp = await sendMessage({ type: msgType, value });
  if (resp && resp.ok) {
    setLockInfo(t("lockFlagSaved", t(labelKey), t(value ? "labelOn" : "labelOff")), "saved");
  } else {
    setLockInfo(t("saveFailed", (resp && resp.error) || t("unknownError")), "error");
    // 回滾畫面狀態
    $(checkboxId).checked = !value;
  }
}

$("lock-blacklist").addEventListener("change", () => {
  saveLockFlag("lock-blacklist", "SET_LOCK_BLACKLIST", "lockBlacklistShortLabel");
});
$("lock-young").addEventListener("change", () => {
  saveLockFlag("lock-young", "SET_LOCK_YOUNG", "lockYoungShortLabel");
});

// === 偵測奇怪域名（提醒級橫幅,預設關）===

function setOddNameInfo(text, status /* "saved" | "error" | null */) {
  const el = $("odd-name-info");
  el.textContent = text;
  el.className = "settings-info";
  if (status === "saved") el.classList.add("is-saved");
  if (status === "error") el.classList.add("is-error");
}

async function loadOddNameToggle() {
  const resp = await sendMessage({ type: "GET_DETECT_ODD_NAME" });
  const on = !!(resp && resp.value);
  $("odd-name-detect").checked = on;
  setOddNameInfo(on ? t("oddNameEnabled") : t("oddNameDisabled"), null);
}

async function saveOddNameFlag() {
  const value = $("odd-name-detect").checked;
  const resp = await sendMessage({ type: "SET_DETECT_ODD_NAME", value });
  if (resp && resp.ok) {
    setOddNameInfo(t("oddNameFlagSaved", t(value ? "labelOn" : "labelOff")), "saved");
  } else {
    setOddNameInfo(t("saveFailed", (resp && resp.error) || t("unknownError")), "error");
    $("odd-name-detect").checked = !value; // 回滾畫面狀態
  }
}

$("odd-name-detect").addEventListener("change", saveOddNameFlag);

// === 偵測子網域品牌偽裝（提醒級橫幅,預設開）===

function setBrandSpoofInfo(text, status /* "saved" | "error" | null */) {
  const el = $("brand-spoof-info");
  el.textContent = text;
  el.className = "settings-info";
  if (status === "saved") el.classList.add("is-saved");
  if (status === "error") el.classList.add("is-error");
}

async function loadBrandSpoofToggle() {
  const resp = await sendMessage({ type: "GET_DETECT_BRAND_SPOOF" });
  // 此設定預設「開」:讀取失敗（resp 無 value）時不可硬轉 false,否則畫面顯示
  // 與實際生效值相反。
  const on = resp && typeof resp.value === "boolean" ? resp.value : true;
  $("brand-spoof-detect").checked = on;
  setBrandSpoofInfo(on ? t("brandSpoofEnabled") : t("brandSpoofDisabled"), null);
}

// 內建品牌清單（透明度:讓使用者能稽核到底比對哪些品牌）。清單是內建常數,載入一次即可。
async function loadBrandList() {
  const resp = await sendMessage({ type: "GET_BRAND_LIST" });
  const list = (resp && resp.list) || [];
  if (list.length === 0) return;
  $("brand-list").textContent =
    t("brandSpoofListLabel") + " " + list.map(b => `${b.brand}（${b.official}）`).join("、");
}

async function saveBrandSpoofFlag() {
  const value = $("brand-spoof-detect").checked;
  const resp = await sendMessage({ type: "SET_DETECT_BRAND_SPOOF", value });
  if (resp && resp.ok) {
    setBrandSpoofInfo(t("brandSpoofFlagSaved", t(value ? "labelOn" : "labelOff")), "saved");
  } else {
    setBrandSpoofInfo(t("saveFailed", (resp && resp.error) || t("unknownError")), "error");
    $("brand-spoof-detect").checked = !value; // 回滾畫面狀態
  }
}

$("brand-spoof-detect").addEventListener("change", saveBrandSpoofFlag);

// === 快取 ===

async function refreshCacheCount() {
  const resp = await sendMessage({ type: "GET_CACHE_COUNT" });
  const n = resp && typeof resp.count === "number" ? resp.count : 0;
  $("cache-info").textContent = t("cacheCurrent", n);
}

$("clear-cache").addEventListener("click", async () => {
  const btn = $("clear-cache");
  btn.disabled = true;
  btn.textContent = t("cacheClearing");
  const resp = await sendMessage({ type: "CLEAR_CACHE" });
  const n = resp && typeof resp.cleared === "number" ? resp.cleared : 0;
  $("cache-info").textContent = t("cacheCleared", n);
  btn.textContent = t("clearCacheButton");
  btn.disabled = false;
});

// === 本次工作階段統計 ===

async function refreshSessionStats() {
  const resp = await sendMessage({ type: "GET_SESSION_STATS" });
  const s = (resp && resp.stats) || { rdapFetches: 0, cacheHits: 0, skipByList: 0 };
  const fetch = s.rdapFetches | 0;
  const cache = s.cacheHits | 0;
  const list = s.skipByList | 0;
  const saved = cache + list;
  const total = fetch + saved;

  $("stat-fetch").textContent = fetch;
  $("stat-cache").textContent = cache;
  $("stat-list").textContent = list;
  $("stat-saved").textContent = saved;

  const rate = total > 0 ? Math.round((saved / total) * 100) : 0;
  $("stats-hit-rate").textContent = total === 0
    ? t("statsNoData")
    : t("statsHitRate", rate, total, saved);
}

// === 備份 / 匯入 ===

const BACKUP_FORMAT_TAG = "Blue-Ringed-Octopus";
const BACKUP_FORMAT_VERSION = 1;

function setBackupInfo(text, status /* "saved" | "error" | null */) {
  const el = $("backup-info");
  el.textContent = text;
  el.className = "settings-info";
  if (status === "saved") el.classList.add("is-saved");
  if (status === "error") el.classList.add("is-error");
}

async function doExport() {
  const btn = $("backup-export");
  btn.disabled = true;
  try {
    const [wl, bl, tldDetail, threshold, overlay, lock, oddName, brandSpoof] = await Promise.all([
      sendMessage({ type: "GET_WHITELIST" }),
      sendMessage({ type: "GET_BLACKLIST" }),
      sendMessage({ type: "GET_HIGH_RISK_TLDS_DETAIL" }),
      sendMessage({ type: "GET_THRESHOLD" }),
      sendMessage({ type: "GET_OVERLAY_FLAGS" }),
      sendMessage({ type: "GET_LOCK_FLAGS" }),
      sendMessage({ type: "GET_DETECT_ODD_NAME" }),
      sendMessage({ type: "GET_DETECT_BRAND_SPOOF" }),
    ]);
    const whitelist = (wl && wl.list) || [];
    const blacklist = (bl && bl.list) || [];
    const userAdded = (tldDetail && tldDetail.userAdded) || [];
    const builtin = (tldDetail && tldDetail.builtin) || [];
    const userRemoved = builtin.filter(b => b.disabled).map(b => b.tld);

    const payload = {
      bro: BACKUP_FORMAT_TAG,
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      whitelist,
      blacklist,
      userHighRiskTldsAdd: userAdded,
      userHighRiskTldsRemove: userRemoved,
      warnThresholdDays: (threshold && threshold.value) || null,
      overlayBlacklist: !!(overlay && overlay.flags && overlay.flags.blacklist),
      overlayYoung: !!(overlay && overlay.flags && overlay.flags.young),
      overlayHighRiskTld: !!(overlay && overlay.flags && overlay.flags.highRiskTld),
      lockBlacklist: !!(lock && lock.flags && lock.flags.blacklist),
      lockYoung: !!(lock && lock.flags && lock.flags.young),
      detectOddName: !!(oddName && oddName.value),
      // 預設「開」的設定:讀取失敗時匯出 true（預設值）,不可硬轉 false,
      // 否則備份→還原會把別台機器的預設開靜默關掉。
      detectBrandSpoof: brandSpoof && typeof brandSpoof.value === "boolean" ? brandSpoof.value : true,
      ui_locale: getCurrentLocale(),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `bro-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setBackupInfo(t("backupExportOk", whitelist.length + blacklist.length), "saved");
  } catch (err) {
    setBackupInfo(t("backupExportFailed", String(err && err.message || err)), "error");
  } finally {
    btn.disabled = false;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsText(file);
  });
}

async function applyImport(parsed, includeSettings) {
  let wlAdded = 0, blAdded = 0, tldAdded = 0, rejected = 0;

  if (Array.isArray(parsed.whitelist)) {
    for (const d of parsed.whitelist) {
      if (typeof d !== "string") continue;
      const resp = await sendMessage({ type: "ADD_WHITELIST", domain: d });
      // 舊版備份可能含 IP / 單段 host 等如今會被拒絕的項目（存入時改化約成 eTLD+1）
      // —— 計數回報而非靜默丟棄,與單筆新增 / 批次匯入的失敗回饋同口徑。
      if (!resp || resp.ok === false) rejected++;
      else if (!resp.alreadyExists) wlAdded++;
    }
  }
  if (Array.isArray(parsed.blacklist)) {
    for (const d of parsed.blacklist) {
      if (typeof d !== "string") continue;
      const resp = await sendMessage({ type: "ADD_BLACKLIST", domain: d });
      if (!resp || resp.ok === false) rejected++;
      else if (!resp.alreadyExists) blAdded++;
    }
  }
  if (Array.isArray(parsed.userHighRiskTldsAdd)) {
    for (const tld of parsed.userHighRiskTldsAdd) {
      if (typeof tld !== "string") continue;
      const resp = await sendMessage({ type: "ADD_HIGH_RISK_TLD", tld });
      if (resp && resp.ok && !resp.alreadyExists && !resp.restored) tldAdded++;
    }
  }
  if (Array.isArray(parsed.userHighRiskTldsRemove)) {
    for (const tld of parsed.userHighRiskTldsRemove) {
      if (typeof tld !== "string") continue;
      await sendMessage({ type: "REMOVE_HIGH_RISK_TLD", tld });
    }
  }

  if (includeSettings) {
    if (typeof parsed.warnThresholdDays === "number") {
      await sendMessage({ type: "SET_THRESHOLD", days: parsed.warnThresholdDays });
    }
    if (typeof parsed.overlayBlacklist === "boolean") {
      await sendMessage({ type: "SET_OVERLAY_BLACKLIST", value: parsed.overlayBlacklist });
    }
    if (typeof parsed.overlayYoung === "boolean") {
      await sendMessage({ type: "SET_OVERLAY_YOUNG", value: parsed.overlayYoung });
    }
    if (typeof parsed.overlayHighRiskTld === "boolean") {
      await sendMessage({ type: "SET_OVERLAY_HIGH_RISK_TLD", value: parsed.overlayHighRiskTld });
    }
    if (typeof parsed.lockBlacklist === "boolean") {
      await sendMessage({ type: "SET_LOCK_BLACKLIST", value: parsed.lockBlacklist });
    }
    if (typeof parsed.lockYoung === "boolean") {
      await sendMessage({ type: "SET_LOCK_YOUNG", value: parsed.lockYoung });
    }
    if (typeof parsed.detectOddName === "boolean") {
      await sendMessage({ type: "SET_DETECT_ODD_NAME", value: parsed.detectOddName });
    }
    if (typeof parsed.detectBrandSpoof === "boolean") {
      await sendMessage({ type: "SET_DETECT_BRAND_SPOOF", value: parsed.detectBrandSpoof });
    }
    if (typeof parsed.ui_locale === "string" && SUPPORTED_LOCALES.includes(parsed.ui_locale)) {
      await setPreferredLocale(parsed.ui_locale);
    }
  }

  return { wlAdded, blAdded, tldAdded, rejected };
}

async function doImport(file) {
  const btn = $("backup-import");
  btn.disabled = true;
  setBackupInfo(t("backupParsing"), null);

  try {
    const text = await readFileAsText(file);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setBackupInfo(t("backupImportInvalid", t("backupErrJsonParse")), "error");
      return;
    }
    if (!parsed || typeof parsed !== "object" || parsed.bro !== BACKUP_FORMAT_TAG) {
      setBackupInfo(t("backupImportInvalid", t("backupErrNotBackup")), "error");
      return;
    }

    const hasAnyData =
      Array.isArray(parsed.whitelist) && parsed.whitelist.length > 0 ||
      Array.isArray(parsed.blacklist) && parsed.blacklist.length > 0 ||
      Array.isArray(parsed.userHighRiskTldsAdd) && parsed.userHighRiskTldsAdd.length > 0 ||
      Array.isArray(parsed.userHighRiskTldsRemove) && parsed.userHighRiskTldsRemove.length > 0;
    const includeSettings = $("backup-include-settings").checked;
    const hasSettings = includeSettings && (
      typeof parsed.warnThresholdDays === "number" ||
      typeof parsed.overlayBlacklist === "boolean" ||
      typeof parsed.overlayYoung === "boolean" ||
      typeof parsed.overlayHighRiskTld === "boolean" ||
      typeof parsed.lockBlacklist === "boolean" ||
      typeof parsed.lockYoung === "boolean" ||
      typeof parsed.detectOddName === "boolean" ||
      typeof parsed.detectBrandSpoof === "boolean" ||
      typeof parsed.ui_locale === "string"
    );

    if (!hasAnyData && !hasSettings) {
      setBackupInfo(t("backupImportNoData"), "error");
      return;
    }

    const { wlAdded, blAdded, tldAdded, rejected } = await applyImport(parsed, includeSettings);

    // 重整 UI
    await refreshLists();
    await loadHighRiskTlds();
    if (includeSettings) {
      await loadThreshold();
      await loadOverlayToggles();
      await loadLockToggles();
      await loadOddNameToggle();
      await loadBrandSpoofToggle();
      // 語言可能變了,簡單重整頁面即可套用
      if (typeof parsed.ui_locale === "string" && parsed.ui_locale !== getCurrentLocale()) {
        location.reload();
        return;
      }
    }

    const okMsg = t("backupImportOk", wlAdded, blAdded, tldAdded);
    if (rejected > 0) {
      setBackupInfo(`${okMsg} / ${t("batchFailed", rejected)}`, "error");
    } else {
      setBackupInfo(okMsg, "saved");
    }
  } catch (err) {
    setBackupInfo(t("backupImportInvalid", String(err && err.message || err)), "error");
  } finally {
    btn.disabled = false;
    $("backup-file").value = "";
  }
}

$("backup-export").addEventListener("click", doExport);
$("backup-import").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) doImport(file);
});

// === Init ===
(async () => {
  await initI18n();
  applyI18n();
  initLanguageSelector();
  refreshLists();
  refreshCacheCount();
  refreshSessionStats();
  loadTrustedTlds();
  loadHighRiskTlds();
  loadHighRiskRegistrars();
  loadThreshold();
  loadOverlayToggles();
  loadLockToggles();
  loadOddNameToggle();
  loadBrandSpoofToggle();
  loadBrandList();
})();
