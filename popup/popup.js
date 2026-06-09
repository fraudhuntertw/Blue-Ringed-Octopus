/**
 * Popup 邏輯（精簡版）：
 *   - 當前網域狀態渲染（含 RDAP 詳細資料）
 *   - 加入 / 移出 當前網域的 白名單 + 黑名單
 *   - 「開啟選項頁」連結
 *
 * 名單管理、TLD/註冊商清單、告警門檻、清除快取等已移至 options 頁。
 */

import { initI18n, applyI18n, t } from "../lib/i18n.js";

const $ = (id) => document.getElementById(id);

let currentDomain = null;
let currentStatus = null;

// === Helpers ===

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function formatAge(days) {
  if (typeof days !== "number") return "—";
  if (days < 30) return t("ageDays", days);
  if (days < 365) return t("ageDaysMonths", days, Math.floor(days / 30));
  return t("ageDaysYears", days, (days / 365).toFixed(1));
}

function setStatus(text, className) {
  const el = $("status");
  el.textContent = text;
  el.className = "value";
  if (className) el.classList.add(className);
}

function renderTags(tags) {
  const el = $("tags");
  el.innerHTML = "";
  if (!tags || tags.length === 0) {
    el.hidden = true;
    return;
  }
  for (const tg of tags) {
    const span = document.createElement("span");
    span.className = `tag ${tg.cls}`;
    span.textContent = tg.label;
    el.appendChild(span);
  }
  el.hidden = false;
}

function setRow(rowId, valueId, text) {
  const row = $(rowId);
  if (!text) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  $(valueId).textContent = text;
}

// 拒絕含 mailto 控制字元（?, &, #）、空白、引號等 — 防止
// RDAP 回傳的惡意 email 把 href 變成 ?cc=...&body=... 之類預填參數。
function isSafeEmail(s) {
  if (typeof s !== "string") return false;
  if (s.length === 0 || s.length > 254) return false;
  if (/[\s<>"'`,;?#&\\]/.test(s)) return false;
  const m = s.match(/^([^@]+)@([^@]+)$/);
  if (!m) return false;
  return m[2].includes(".");
}

function showDetails(result, highRiskRegistrar) {
  $("details").hidden = false;
  $("reg-date").textContent = formatDate(result.registrationDate);
  $("age").textContent = formatAge(result.ageDays);

  if (result.registrar && result.registrar.name) {
    const r = result.registrar;
    $("row-registrar").hidden = false;
    const cell = $("registrar");
    cell.textContent = "";
    cell.appendChild(document.createTextNode(r.name));
    if (r.ianaId) {
      const ianaSpan = document.createElement("span");
      ianaSpan.style.color = "#9ca3af";
      ianaSpan.style.fontWeight = "500";
      ianaSpan.textContent = ` (IANA #${r.ianaId})`;
      cell.appendChild(ianaSpan);
    }
    if (highRiskRegistrar) {
      const warn = document.createElement("span");
      warn.className = "registrar-warn";
      warn.textContent = t("registrarHighRiskBadge");
      cell.appendChild(warn);
    }
  } else {
    $("row-registrar").hidden = true;
  }

  const rant = result.registrant;
  if (rant && (rant.name || rant.email || rant.org)) {
    setRow("row-registrant-name", "registrant-name", rant.name);
    setRow("row-registrant-org", "registrant-org", rant.org);
    if (rant.email) {
      const cell = $("registrant-email");
      cell.textContent = "";
      if (isSafeEmail(rant.email)) {
        const a = document.createElement("a");
        a.href = `mailto:${rant.email}`;
        a.textContent = rant.email;
        cell.appendChild(a);
      } else {
        // 格式不對（含參數注入字元 / 多 @ / 無 domain）→ 純文字顯示，不做成連結
        cell.textContent = rant.email;
      }
      $("row-registrant-email").hidden = false;
    } else {
      $("row-registrant-email").hidden = true;
    }
    $("row-redacted").hidden = true;
  } else {
    $("row-registrant-name").hidden = true;
    $("row-registrant-org").hidden = true;
    $("row-registrant-email").hidden = true;
    $("row-redacted").hidden = !(result.registrar || result.registrationDate);
  }
}

function hideDetails() {
  $("details").hidden = true;
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn("[BRO popup] sendMessage error:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(resp);
    });
  });
}

// === Status render ===

async function renderStatus() {
  const tab = await getCurrentTab();
  if (!tab || !tab.url) {
    $("domain").textContent = "—";
    setStatus(t("noTabAvailable"), "is-muted");
    updateActionButtons(null);
    return;
  }

  const resp = await sendMessage({ type: "GET_STATUS", url: tab.url });
  currentStatus = resp;

  if (!resp) {
    $("domain").textContent = "—";
    setStatus(t("backgroundUnresponsive"), "is-muted");
    updateActionButtons(null);
    return;
  }

  if (resp.state === "skipped") {
    $("domain").textContent = new URL(tab.url).hostname || "—";
    setStatus(t("notChecked"), "is-muted");
    renderTags([]);
    hideDetails();
    updateActionButtons(null);
    currentDomain = null;
    return;
  }

  if (resp.state === "invalid_domain") {
    $("domain").textContent = "—";
    setStatus(t("cannotParseDomain"), "is-muted");
    renderTags([]);
    hideDetails();
    updateActionButtons(null);
    currentDomain = null;
    return;
  }

  currentDomain = resp.domain;
  $("domain").textContent = resp.domain || "—";

  const tags = [];
  if (resp.trustedTld)        tags.push({ cls: "tag-trusted",   label: t("tagTrusted") });
  if (resp.highRiskTld)       tags.push({ cls: "tag-tld",       label: t("tagHighRiskTld") });
  if (resp.highRiskRegistrar) tags.push({ cls: "tag-registrar", label: t("tagHighRiskRegistrar") });
  if (resp.oddName)           tags.push({ cls: "tag-odd",       label: t("tagOddName") });
  if (resp.blacklisted)       tags.push({ cls: "tag-bl",        label: t("tagBlacklist") });
  if (resp.whitelisted)       tags.push({ cls: "tag-wl",        label: t("tagWhitelist") });
  renderTags(tags);

  if (resp.blacklisted) {
    setStatus(t("statusBlacklisted"), "is-bl");
    hideDetails();
    updateActionButtons(resp);
    return;
  }

  if (resp.whitelisted) {
    setStatus(t("statusWhitelisted"), "is-safe");
    if (resp.result && resp.result.status === "ok") showDetails(resp.result, resp.highRiskRegistrar);
    else hideDetails();
    updateActionButtons(resp);
    return;
  }

  if (resp.trustedTld) {
    setStatus(t("statusTrustedTld"), "is-safe");
    hideDetails();
    updateActionButtons(resp);
    return;
  }

  if (resp.state === "not_queried") {
    setStatus(t("statusNotQueried"), "is-muted");
    hideDetails();
    updateActionButtons(resp);
    return;
  }

  const r = resp.result;
  const threshold = typeof resp.threshold === "number" ? resp.threshold : 30;
  if (r.status === "ok") {
    if (typeof r.ageDays === "number" && r.ageDays < threshold) {
      setStatus(t("statusYoung", r.ageDays, threshold), "is-warning");
    } else {
      setStatus(t("statusOk", threshold), "is-safe");
    }
    showDetails(r, resp.highRiskRegistrar);
  } else if (r.status === "unsupported") {
    setStatus(t("statusUnsupported", r.reason || ""), "is-muted");
    hideDetails();
  } else {
    setStatus(t("statusError", r.reason || t("unknownError")), "is-muted");
    hideDetails();
  }
  updateActionButtons(resp);
}

// 顯示/隱藏鎖定提示（紅字）。kind 決定文案：young 額外說明「滿門檻會自動放行」。
function showLockNote(kind /* "blacklist" | "young" */) {
  const lockNote = $("lock-note");
  if (!lockNote) return;
  const key = kind === "young" ? "popupLockedNoteYoung" : "popupLockedNote";
  lockNote.textContent = `🔒 ${t(key)}`;
  lockNote.hidden = false;
}

function hideLockNote() {
  const lockNote = $("lock-note");
  if (lockNote) lockNote.hidden = true;
}

function updateActionButtons(resp) {
  const wlBtn = $("btn-whitelist");
  const blBtn = $("btn-blacklist");

  if (!resp || !resp.domain) {
    wlBtn.disabled = true;
    blBtn.disabled = true;
    wlBtn.textContent = t("btnAddToWhitelist");
    blBtn.textContent = t("btnAddToBlacklist");
    hideLockNote();
    return;
  }

  wlBtn.disabled = false;
  blBtn.disabled = false;

  wlBtn.textContent = t(resp.whitelisted ? "btnRemoveFromWhitelist" : "btnAddToWhitelist");
  blBtn.textContent = t(resp.blacklisted ? "btnRemoveFromBlacklist" : "btnAddToBlacklist");

  // === 鎖定：停用會「削弱保護」的按鈕,只能從選項頁解除 ===
  // 注意:這只是「即時可見」的 UX 停用,實際寫入仍由 background 守門（不依賴 cache）,
  // 故 cache 冷導致按鈕誤啟用時,點下去仍會被擋並補顯示鎖定提示。
  const threshold = typeof resp.threshold === "number" ? resp.threshold : 30;
  const isYoung = !!(resp.result && resp.result.status === "ok"
    && typeof resp.result.ageDays === "number" && resp.result.ageDays < threshold);
  // 黑名單鎖定 → 停用「移出黑名單」;「加入白名單」對黑名單無效（黑名單優先於白名單）,
  //   一併停用,避免誤導使用者並防止殘留白名單日後靜默放行。
  const blLocked = !!(resp.blacklisted && resp.lockBlacklist);
  // 短註冊鎖定 → 不能把尚未白名單的短註冊網域「加入白名單」；
  //   已白名單則按鈕是「移出白名單」(會加嚴,不削弱),不鎖。
  const wlLocked = !!(isYoung && resp.lockYoung && !resp.whitelisted);

  if (blLocked) {
    blBtn.disabled = true;
    wlBtn.disabled = true;
  }
  if (wlLocked) wlBtn.disabled = true;

  if (blLocked || wlLocked) showLockNote(blLocked ? "blacklist" : "young");
  else hideLockNote();
}

// === Event wiring ===

// 被 background 鎖定守門擋下時的共用處理：顯示鎖定提示並停用該按鈕。
function handleLockedResponse(resp, btnId) {
  if (resp && resp.ok === false && resp.reason === "locked") {
    showLockNote(resp.lockKind === "young" ? "young" : "blacklist");
    $(btnId).disabled = true;
    return true;
  }
  return false;
}

$("btn-whitelist").addEventListener("click", async () => {
  if (!currentDomain || !currentStatus) return;
  if (currentStatus.whitelisted) {
    // 移出白名單 = 加嚴保護,不受鎖定限制
    await sendMessage({ type: "REMOVE_WHITELIST", domain: currentDomain });
  } else {
    // 加入白名單 = 削弱保護,帶 enforceLock 交由 background 守門
    const resp = await sendMessage({ type: "ADD_WHITELIST", domain: currentDomain, enforceLock: true });
    if (handleLockedResponse(resp, "btn-whitelist")) return;
  }
  await renderStatus();
});

$("btn-blacklist").addEventListener("click", async () => {
  if (!currentDomain || !currentStatus) return;
  if (currentStatus.blacklisted) {
    // 移出黑名單 = 削弱保護,帶 enforceLock 交由 background 守門
    const resp = await sendMessage({ type: "REMOVE_BLACKLIST", domain: currentDomain, enforceLock: true });
    if (handleLockedResponse(resp, "btn-blacklist")) return;
  } else {
    // 加入黑名單 = 加嚴保護,不受鎖定限制
    await sendMessage({ type: "ADD_BLACKLIST", domain: currentDomain });
  }
  await renderStatus();
});

$("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// === 免造訪查詢台（Q1）===
// 定位:這是「風險訊號查詢」,不是「詐騙與否的判定」。
// 對應 background 的 CHECK_DOMAIN handler。

// classification → { textKey/動態文字, css class }
function lookupStatusOf(verdict) {
  const threshold = typeof verdict.threshold === "number" ? verdict.threshold : 30;
  const r = verdict.result;
  switch (verdict.classification) {
    case "blacklist":
      return { text: t("statusBlacklisted"), cls: "is-bl" };
    case "whitelist":
      return { text: t("statusWhitelisted"), cls: "is-safe" };
    case "trusted":
      return { text: t("statusTrustedTld"), cls: "is-safe" };
    case "young":
      return { text: t("statusYoung", r ? r.ageDays : "?", threshold), cls: "is-warning" };
    case "high_risk_tld":
      return { text: t("lookupStatusHighRiskTld"), cls: "is-warn" };
    case "high_risk_registrar":
      return { text: t("lookupStatusHighRiskRegistrar"), cls: "is-warn" };
    case "odd_name":
      return { text: t("lookupStatusOddName"), cls: "is-warn" };
    case "ok":
      return { text: t("statusOk", threshold), cls: "is-safe" };
    case "unsupported":
      return { text: t("statusUnsupported", (r && r.reason) || ""), cls: "is-muted" };
    case "error":
      return { text: t("statusError", (r && r.reason) || t("unknownError")), cls: "is-muted" };
    default:
      return { text: t("statusNotQueried"), cls: "is-muted" };
  }
}

function lookupTags(verdict) {
  const tags = [];
  if (verdict.trustedTld)        tags.push({ cls: "tag-trusted",   label: t("tagTrusted") });
  if (verdict.highRiskTld)       tags.push({ cls: "tag-tld",       label: t("tagHighRiskTld") });
  if (verdict.highRiskRegistrar) tags.push({ cls: "tag-registrar", label: t("tagHighRiskRegistrar") });
  if (verdict.oddName)           tags.push({ cls: "tag-odd",       label: t("tagOddName") });
  if (verdict.blacklisted)       tags.push({ cls: "tag-bl",        label: t("tagBlacklist") });
  if (verdict.whitelisted)       tags.push({ cls: "tag-wl",        label: t("tagWhitelist") });
  return tags;
}

function appendRow(parent, labelText, valueText) {
  if (!valueText) return;
  const row = document.createElement("div");
  row.className = "row";
  const l = document.createElement("span");
  l.className = "row-label";
  l.textContent = labelText;
  const val = document.createElement("span");
  val.className = "row-value";
  val.textContent = valueText;
  row.appendChild(l);
  row.appendChild(val);
  parent.appendChild(row);
}

function renderLookupResult(resp) {
  const box = $("lookup-result");
  box.textContent = "";
  box.hidden = false;

  // 非 checked 狀態：單行訊息
  const simpleMsg = {
    empty: t("lookupEmpty"),
    invalid: t("lookupInvalid"),
    invalid_domain: t("lookupInvalid"),
    skipped: t("lookupSkipped"),
  };
  if (!resp || !resp.ok) {
    const p = document.createElement("p");
    p.className = "lookup-msg is-muted";
    p.textContent = t("backgroundUnresponsive");
    box.appendChild(p);
    return;
  }
  if (resp.state !== "checked") {
    const p = document.createElement("p");
    p.className = "lookup-msg is-muted";
    p.textContent = simpleMsg[resp.state] || t("lookupInvalid");
    box.appendChild(p);
    return;
  }

  const verdict = resp.verdict;

  // 短網址警示（最上方,最醒目）
  if (resp.isShortener) {
    const warn = document.createElement("p");
    warn.className = "lookup-shortener";
    warn.textContent = t("lookupShortener");
    box.appendChild(warn);
  }

  // 查詢的網域
  const domEl = document.createElement("div");
  domEl.className = "lookup-domain";
  domEl.textContent = resp.domain;
  box.appendChild(domEl);

  // 狀態
  const st = lookupStatusOf(verdict);
  const stEl = document.createElement("div");
  stEl.className = `lookup-status ${st.cls}`;
  stEl.textContent = st.text;
  box.appendChild(stEl);

  // 標籤
  const tags = lookupTags(verdict);
  if (tags.length) {
    const tagWrap = document.createElement("div");
    tagWrap.className = "tags";
    for (const tg of tags) {
      const span = document.createElement("span");
      span.className = `tag ${tg.cls}`;
      span.textContent = tg.label;
      tagWrap.appendChild(span);
    }
    box.appendChild(tagWrap);
  }

  // 詳細（RDAP ok 時）
  const r = verdict.result;
  if (r && r.status === "ok") {
    const details = document.createElement("div");
    details.className = "details";
    appendRow(details, t("labelRegistrationDate"), formatDate(r.registrationDate));
    appendRow(details, t("labelAge"), formatAge(r.ageDays));
    if (r.registrar && r.registrar.name) {
      const reg = r.registrar.ianaId
        ? `${r.registrar.name} (IANA #${r.registrar.ianaId})`
        : r.registrar.name;
      appendRow(details, t("labelRegistrar"), reg);
    }
    if (details.childElementCount) box.appendChild(details);
  }

  // 誠實聲明（永遠顯示）：風險訊號 ≠ 詐騙判定;沒警示 ≠ 安全
  const disc = document.createElement("p");
  disc.className = "lookup-disclaimer";
  disc.textContent = t("lookupDisclaimer");
  box.appendChild(disc);
}

async function runLookup() {
  const input = $("lookup-input");
  const btn = $("lookup-btn");
  const raw = input.value;
  if (!raw || !raw.trim()) {
    renderLookupResult({ ok: true, state: "empty" });
    return;
  }
  const box = $("lookup-result");
  box.textContent = "";
  box.hidden = false;
  const loading = document.createElement("p");
  loading.className = "lookup-msg is-muted";
  loading.textContent = t("lookupChecking");
  box.appendChild(loading);

  btn.disabled = true;
  input.disabled = true;
  try {
    const resp = await sendMessage({ type: "CHECK_DOMAIN", input: raw });
    renderLookupResult(resp);
  } finally {
    btn.disabled = false;
    input.disabled = false;
  }
}

function setupLookup() {
  const toggle = $("lookup-toggle");
  const panel = $("lookup-panel");
  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) $("lookup-input").focus();
  });
  $("lookup-btn").addEventListener("click", runLookup);
  $("lookup-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runLookup();
    }
  });
}

// === Init ===
(async () => {
  await initI18n();
  applyI18n();
  setupLookup();
  await renderStatus();
})();
