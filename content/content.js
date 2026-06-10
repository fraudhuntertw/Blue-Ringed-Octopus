/**
 * Content Script：收到 SHOW_WARNING 時注入橫幅或全畫面蓋版。
 *
 * Payload 形態：
 *   {
 *     reason: "young" | "blacklist" | "high_risk_tld",
 *     domain, registrationDate?, ageDays?, threshold?, tld?,
 *     isHighRiskTld?, overlay?,
 *     strings: { message, title, tags: [{cls,label}], dismissLabel, closeAriaLabel }
 *   }
 *
 * 所有 user-visible 字串由 background.js 依使用者選擇的語言預先格式化,
 * content script 只負責 render。
 *
 * 渲染分派（依 reason 與 overlay）：
 *   - blacklist + overlay=true    → 蓋版 + 頂端橫幅（風險高，雙保險）
 *   - young + overlay=true        → 蓋版 + 頂端橫幅（風險高，雙保險）
 *   - high_risk_tld + overlay=true → 蓋版（提醒級，蓋版已足夠，不疊橫幅）
 *   - 其餘                          → 頂端橫幅
 *
 * 顏色：young / blacklist 紅色；high_risk_tld 橘色（提醒級）。
 *
 * Dismiss 行為：
 *   - high_risk_tld 按關閉後寫入 sessionStorage，本分頁同 domain 不再彈
 *   - young / blacklist 不做 session dismiss（重新整理會再次出現，因為較嚴重）
 *
 * MV3 content script 不支援 ES module，這裡用 IIFE。
 */

(() => {
  "use strict";

  const BANNER_ID = "zeromonth-alert-banner";
  const OVERLAY_ID = "zeromonth-alert-overlay";

  // 提醒級（橘色）告警：橘色樣式 + 關閉後本分頁同 domain 記憶不再彈。
  // young / blacklist 屬告警級（紅色）,重新整理會再次出現,不在此列。
  const REMINDER_REASONS = new Set(["high_risk_tld", "odd_name", "brand_subdomain"]);
  const isReminder = (payload) => !!(payload && REMINDER_REASONS.has(payload.reason));

  const dismissKey = (reason, domain) => `bro-dismiss:${reason}:${domain}`;

  function isDismissed(payload) {
    if (!payload || !payload.domain || !isReminder(payload)) return false;
    try {
      return sessionStorage.getItem(dismissKey(payload.reason, payload.domain)) === "1";
    } catch (err) {
      return false;
    }
  }

  function markDismissed(payload) {
    if (!payload || !payload.domain || !isReminder(payload)) return;
    try {
      sessionStorage.setItem(dismissKey(payload.reason, payload.domain), "1");
    } catch (err) {
      // 部分頁面（data: URL、嚴格 CSP）會擋 sessionStorage，吞掉
    }
  }

  function stringsOf(payload) {
    return (payload && payload.strings) || {
      message: "", title: "", tags: [], dismissLabel: "", closeAriaLabel: ""
    };
  }

  // 鎖定告警：開啟後本頁無法關閉/略過/加入白名單,只能從選項頁解除
  // （短註冊網域亦可等到超過門檻天數自動放行）。
  function isLocked(payload) {
    return !!(payload && payload.locked);
  }

  // 鎖定狀態下顯示的紅底提示，告訴使用者「為什麼沒有關閉鈕、要怎麼解除」。
  function buildLockedNote(s) {
    const note = document.createElement("div");
    note.className = "zm-locked-note";
    const icon = document.createElement("span");
    icon.className = "zm-locked-icon";
    icon.textContent = "🔒";
    const text = document.createElement("span");
    text.className = "zm-locked-text";
    text.textContent = s.lockedNote || "";
    note.appendChild(icon);
    note.appendChild(text);
    return note;
  }

  // 「為何被標記」逐項證據 + 建議怎麼做（Q3）。
  // opts.expanded=true:蓋版空間大,預設展開;橫幅預設收合(toggle 點開)。
  function buildEvidence(s, opts) {
    if (!Array.isArray(s.evidence) || s.evidence.length === 0) return null;

    const wrap = document.createElement("div");
    wrap.className = "zm-evidence";

    const list = document.createElement("div");
    list.className = "zm-evidence-list";

    for (const ev of s.evidence) {
      const row = document.createElement("div");
      row.className = "zm-evidence-row";
      const l = document.createElement("span");
      l.className = "zm-evidence-label";
      l.textContent = ev.label;
      const d = document.createElement("span");
      d.className = "zm-evidence-detail";
      d.textContent = ev.detail;
      row.appendChild(l);
      row.appendChild(d);
      list.appendChild(row);
    }

    if (s.explain) {
      const adv = document.createElement("div");
      adv.className = "zm-evidence-advice";
      const al = document.createElement("span");
      al.className = "zm-evidence-advice-label";
      al.textContent = s.whatToDoLabel || "";
      const at = document.createElement("span");
      at.className = "zm-evidence-advice-text";
      at.textContent = (s.whatToDoLabel ? " " : "") + s.explain;
      adv.appendChild(al);
      adv.appendChild(at);
      list.appendChild(adv);
    }

    const expanded = !!(opts && opts.expanded);
    if (expanded) {
      wrap.appendChild(list);
      return wrap;
    }

    // 收合版：加 toggle 按鈕
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "zm-evidence-toggle";
    toggle.setAttribute("aria-expanded", "false");
    const tlabel = document.createElement("span");
    tlabel.textContent = s.evidenceToggleLabel || "";
    const chev = document.createElement("span");
    chev.className = "zm-evidence-chevron";
    chev.textContent = "▾";
    toggle.appendChild(tlabel);
    toggle.appendChild(chev);

    list.hidden = true;
    toggle.addEventListener("click", () => {
      const open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.classList.toggle("is-open", open);
    });

    wrap.appendChild(toggle);
    wrap.appendChild(list);
    return wrap;
  }

  // 誤報一鍵「標記安全」（Q4）。黑名單不提供（避免把自己標記的惡意域洗白）。
  // 點下 → 通知 background 加入白名單 → 移除告警。
  function buildMarkSafeBtn(payload, s, onDone) {
    if (!payload || !payload.domain) return null;
    if (payload.reason === "blacklist") return null;
    // 鎖定狀態：不提供頁面端「加入白名單」入口（只能從選項頁解除）
    if (isLocked(payload)) return null;
    if (!s.markSafeLabel) return null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zm-marksafe";
    btn.textContent = s.markSafeLabel;
    btn.addEventListener("click", (e) => {
      // 防護:本橫幅注入在「頁面 DOM」內,惡意網頁能用 el.click() 合成點擊觸發此
      // listener,把自己悄悄加進白名單從此不再被告警。只接受真實使用者點擊。
      if (!e.isTrusted) {
        console.warn("[BRO] mark-safe ignored: synthetic click");
        return;
      }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (typeof onDone === "function") onDone();
      };
      try {
        chrome.runtime.sendMessage(
          { type: "MARK_FALSE_POSITIVE", domain: payload.domain },
          (resp) => {
            void chrome.runtime.lastError;
            // 被鎖定守門擋下（locked / lock_indeterminate）或寫入失敗（明確回 ok:false）
            // 時 → 保留告警,不給「已標記安全」的假象。無回應（resp undefined,如 SW
            // 中途被終止）視同無法溝通:白名單並未寫入、下次導航仍會告警,保守移除即可。
            if (resp && resp.ok === false) return;
            finish();
          }
        );
      } catch (err) {
        // background 完全無法溝通（極少見）：保守仍移除,避免使用者卡在告警頁。
        finish();
      }
    });
    return btn;
  }

  function injectOverlay(payload) {
    if (document.getElementById(OVERLAY_ID)) return;
    if (isDismissed(payload)) {
      console.info("[BRO] overlay suppressed (session dismissed):", payload && payload.domain);
      return;
    }
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", () => injectOverlay(payload), { once: true });
      return;
    }

    const s = stringsOf(payload);

    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    if (payload && payload.reason === "high_risk_tld") {
      overlay.classList.add("bro-overlay-warn");
    }

    const card = document.createElement("div");
    card.className = "zm-overlay-card";

    const icon = document.createElement("div");
    icon.className = "zm-overlay-icon";
    icon.textContent = payload && payload.reason === "high_risk_tld" ? "⚠" : "⚠️";

    const title = document.createElement("div");
    title.className = "zm-overlay-title";
    title.textContent = s.title;

    const text = document.createElement("div");
    text.className = "zm-overlay-text";
    text.textContent = s.message;

    card.appendChild(icon);
    card.appendChild(title);
    // 醒目顯示「判斷的主域名（eTLD+1，含 TLD）」—— 讓使用者一眼看到是哪個網域被標記。
    // 所有告警類別（blacklist / young / high_risk_tld）皆顯示。
    if (payload && payload.domain) {
      const dom = document.createElement("div");
      dom.className = "zm-overlay-domain";
      dom.setAttribute("dir", "ltr"); // 網域一律左到右,避免 RTL 頁面把它倒置
      dom.textContent = payload.domain;
      card.appendChild(dom);
    }
    card.appendChild(text);

    if (Array.isArray(s.tags) && s.tags.length > 0) {
      const tagRow = document.createElement("div");
      tagRow.className = "zm-overlay-tags";
      for (const tg of s.tags) {
        const span = document.createElement("span");
        span.className = tg.cls;
        span.textContent = tg.label;
        tagRow.appendChild(span);
      }
      card.appendChild(tagRow);
    }

    const evidence = buildEvidence(s, { expanded: true });
    if (evidence) card.appendChild(evidence);

    if (isLocked(payload)) {
      // 鎖定：不渲染任何關閉/略過/加入白名單按鈕,改放紅底鎖定提示。
      card.appendChild(buildLockedNote(s));
    } else {
      const actions = document.createElement("div");
      actions.className = "zm-overlay-actions";
      const safeBtn = buildMarkSafeBtn(payload, s, () => {
        // 標記安全成功 = 該域已加白名單。young/blacklist 蓋版時頂端橫幅同時存在,
        // 兩者都要移除,避免殘留「已標安全卻仍掛風險告警」的矛盾畫面。
        for (const id of [OVERLAY_ID, BANNER_ID]) {
          const el = document.getElementById(id);
          if (el) el.remove();
        }
      });
      if (safeBtn) {
        safeBtn.classList.add("zm-overlay-marksafe");
        actions.appendChild(safeBtn);
      }
      const close = document.createElement("button");
      close.type = "button";
      close.className = "zm-overlay-close";
      close.textContent = s.dismissLabel;
      close.addEventListener("click", () => {
        markDismissed(payload);
        const el = document.getElementById(OVERLAY_ID);
        if (el) el.remove();
      });
      actions.appendChild(close);
      card.appendChild(actions);
    }

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function injectBanner(payload) {
    if (document.getElementById(BANNER_ID)) return;
    if (isDismissed(payload)) {
      console.info("[BRO] banner suppressed (session dismissed):", payload && payload.domain);
      return;
    }
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", () => injectBanner(payload), { once: true });
      return;
    }

    const s = stringsOf(payload);

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.setAttribute("role", "alert");
    if (isReminder(payload)) {
      banner.classList.add("bro-banner-warn");
    }
    if (isLocked(payload)) {
      // 無關閉鈕 → 收掉右側預留給 ✕ 的內距
      banner.classList.add("bro-banner-locked");
    }

    const mainRow = document.createElement("div");
    mainRow.className = "zm-row zm-row-main";

    const icon = document.createElement("span");
    icon.className = "zm-icon";
    icon.textContent = isReminder(payload) ? "⚠" : "⚠️";

    const text = document.createElement("span");
    text.className = "zm-text";
    text.textContent = s.message;

    mainRow.appendChild(icon);
    mainRow.appendChild(text);
    // 鎖定狀態：不渲染關閉鈕（✕），使用者無法從本頁略過此告警。
    if (!isLocked(payload)) {
      const close = document.createElement("button");
      close.className = "zm-close";
      close.type = "button";
      close.setAttribute("aria-label", s.closeAriaLabel);
      close.textContent = "✕";
      close.addEventListener("click", () => {
        markDismissed(payload);
        const el = document.getElementById(BANNER_ID);
        if (el) el.remove();
      });
      mainRow.appendChild(close);
    }
    banner.appendChild(mainRow);

    // 副標籤列
    if (Array.isArray(s.tags) && s.tags.length > 0) {
      const tagRow = document.createElement("div");
      tagRow.className = "zm-row zm-row-tags";
      for (const tg of s.tags) {
        const span = document.createElement("span");
        span.className = tg.cls;
        span.textContent = tg.label;
        tagRow.appendChild(span);
      }
      banner.appendChild(tagRow);
    }

    const evidence = buildEvidence(s, { expanded: false });
    if (evidence) banner.appendChild(evidence);

    if (isLocked(payload)) {
      // 鎖定：不提供「加入白名單」入口,改放紅底鎖定提示。
      banner.appendChild(buildLockedNote(s));
    } else {
      const safeBtn = buildMarkSafeBtn(payload, s, () => {
        // 同蓋版路徑:標記安全成功時,蓋版與橫幅（可能並存）一併移除。
        for (const id of [OVERLAY_ID, BANNER_ID]) {
          const el = document.getElementById(id);
          if (el) el.remove();
        }
      });
      if (safeBtn) {
        const actRow = document.createElement("div");
        actRow.className = "zm-row zm-row-actions";
        actRow.appendChild(safeBtn);
        banner.appendChild(actRow);
      }
    }

    document.body.prepend(banner);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "SHOW_WARNING") return;
    try {
      const payload = msg.payload;
      // 防 race:慢 RDAP 期間,若本分頁已在同一 tabId 導航到別的網站,checkTab 在
      // 舊 URL 觸發的告警可能被送到新 document 的 content script,把告警打在無關頁面。
      // payload.domain 是 eTLD+1,比對當前 host 後綴不符就丟棄。
      if (payload && payload.domain) {
        const h = (location.hostname || "").toLowerCase().replace(/\.$/, "");
        if (h !== payload.domain && !h.endsWith("." + payload.domain)) {
          console.info("[BRO] warning dropped (host mismatch):", h, "vs", payload.domain);
          return;
        }
      }
      if (payload && payload.overlay) {
        injectOverlay(payload);
        // blacklist / young 屬高風險：蓋版被關掉後仍要有頂端橫幅持續提示。
        // high_risk_tld 只是提醒級，蓋版已足夠，不疊橫幅以免吵。
        if (payload.reason === "young" || payload.reason === "blacklist") {
          injectBanner(payload);
        }
      } else {
        injectBanner(payload);
      }
    } catch (err) {
      console.warn("[BRO] inject warning failed:", err);
    }
  });
})();
