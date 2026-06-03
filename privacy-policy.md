# Blue Ringed Octopus — 隱私權政策 / Privacy Policy

- **適用對象 / Applies to：** Blue Ringed Octopus 瀏覽器擴充功能（Browser extension）
- **版本 / Version：** 0.0.1
- **生效日 / Effective date：** 2026-06-03
- **最後更新 / Last updated：** 2026-06-03

> 本文件同時提供正體中文與 English 兩個版本。中英內容如有歧異，以實際程式行為為準。
> Both 正體中文 and English versions are provided below. In case of discrepancy, the extension's actual behavior governs.

---

## 正體中文

### 摘要（先讀這段）

- 本擴充功能**不會**蒐集、上傳或販售你的個人資料，也**不會**向開發者回傳任何資料（沒有任何分析、遙測或追蹤）。
- 為了判斷網站風險，當你造訪一個一般網頁時，本擴充功能會把該網頁的**主網域（registrable domain，例如 `example.com`）**送到第三方的 RDAP 網域查詢服務，以取得該網域的註冊日期與註冊商資訊。
- **送出的只有主網域**：完整網址、子網域、路徑（path）、查詢字串（query）、錨點（fragment）以及網頁內容**都不會被送出**。
- 註冊日期、設定、你自訂的白／黑名單等資料，只儲存在**你自己的瀏覽器本機**。
- 移除本擴充功能即會清除其在本機儲存的所有資料。

### 1. 本擴充功能做什麼

Blue Ringed Octopus 透過查詢網域的**註冊時間**、判斷是否屬於**高風險頂級域名（TLD）/ 註冊商**，以及比對使用者自訂的白／黑名單，協助你辨識可能的釣魚或詐騙網站，並在頁面上以橫幅或全畫面蓋版提出警示。

### 2. 我們處理哪些資料、如何處理

#### 2.1 你造訪的網域（會送往第三方）

- 當分頁載入完成時，本擴充功能會讀取該分頁的網址，從中抽取**主網域（eTLD+1）**。
- 若該主網域**不在**你的白名單、黑名單、內建可信 TLD 清單中，且**本機尚無有效快取**，才會把該主網域送往下列第三方 RDAP 服務查詢註冊資訊：
  - `https://rdap.org/domain/{網域}`（IANA bootstrap 服務，會以 HTTP 302 轉址到該網域實際所屬的註冊管理機構 / 註冊商的 RDAP 伺服器）
  - 對部分頂級域名（目前為 `.me` `.io` `.sh` `.ac` `.bz`），若上者查無資料，會改向 `https://rdap.identitydigital.services/rdap/domain/{網域}` 查詢。
- 透過上述轉址機制，被查詢的主網域名稱也會被傳遞給該網域對應的**註冊管理機構 / 註冊商的 RDAP 伺服器**。這些第三方如何處理該查詢，依其各自的隱私政策而定。
- **僅送出主網域字串本身**。完整網址、子網域、路徑、查詢字串、錨點、Cookie、表單內容、網頁內容**一律不送出**。

**哪些頁面不會被查詢：** 瀏覽器內部頁面（如 `chrome://`、`about:`、擴充功能頁、`file:`、`data:`、`view-source:` 等）、`localhost`、私有／保留 IP 網段、純 IP 位址，以及不含點的內部主機名稱，都會被略過，**不會送往任何伺服器**。

#### 2.2 儲存在你本機的資料（不會離開你的瀏覽器）

以下資料只儲存在你瀏覽器的 `chrome.storage` 本機空間，不會上傳：

- **網域查詢快取**（`chrome.storage.local`）：已查詢過的主網域及其註冊日期、網域年齡、註冊商、查詢時間等，保存期限為 **7 天**，用以減少重複查詢。
- **你自訂的清單與設定**（`chrome.storage.local`）：白名單、黑名單、告警門檻天數、警示顯示方式、你自訂的高風險 TLD 增刪清單、介面語言。
- **本次工作階段統計**（`chrome.storage.session`）：僅為查詢次數 / 快取命中次數等**數字計數器**，不含任何網域，且瀏覽器關閉即清除。

#### 2.3 對網頁的存取

- 本擴充功能的 content script 只用來在頁面上**注入警示橫幅 / 蓋版**，**不會讀取、收集或傳送任何網頁內容、表單資料或你輸入的內容**。
- 為記住你在「高風險 TLD」警示上按下的「關閉」狀態（同分頁同網域不再重複彈出），會在該頁的 `sessionStorage` 寫入一個旗標；此資料僅存在於該分頁、不會外傳。

### 3. 我們不會做的事

- 不蒐集姓名、Email、帳號、密碼、付款資訊等個人身分資料。
- 不向開發者或任何分析 / 廣告服務回傳資料（無遙測、無追蹤像素、無廣告 SDK）。
- 不建立、不上傳、不販售你的瀏覽紀錄。
- 不需要註冊或登入帳號。

### 4. 第三方服務

本擴充功能在查詢網域註冊資訊時會連線下列第三方，並向其揭露**被查詢的主網域名稱**：

| 服務 | 用途 | 收到的資料 |
|------|------|-----------|
| `rdap.org` | RDAP bootstrap / 轉址 | 被查詢的主網域 |
| 各網域對應的註冊管理機構 / 註冊商 RDAP 伺服器（由 `rdap.org` 轉址而來） | 提供註冊資料 | 被查詢的主網域 |
| `rdap.identitydigital.services` | 特定 TLD 的備援 RDAP 查詢 | 被查詢的主網域 |

這些服務由第三方營運，其資料處理行為不在本擴充功能控制範圍內，請參閱其各自的隱私政策。

### 5. 資料保存與刪除

- 網域查詢快取的有效期為 **7 天**。
- 你可隨時於本擴充功能的設定 / 彈出視窗中**清除快取**，或自行移除白／黑名單項目。
- **移除（解除安裝）本擴充功能**時，瀏覽器會一併清除其儲存在本機的所有資料。

### 6. 兒童隱私

本擴充功能並非以兒童為對象設計，且不會蒐集任何個人資料。

### 7. 政策變更

若資料處理方式有變動，我們會更新本文件並調整上方「最後更新」日期；重大變動會於擴充功能的更新說明中告知。

### 8. 聯絡方式

如對本隱私政策有疑問，請來信 **fraudhuntertw@gmail.com**，或於本專案 GitHub 儲存庫的 Issues 頁面提出。

---

## English

### Summary (read this first)

- This extension does **not** collect, upload, or sell your personal data, and sends **no** data back to the developer (no analytics, telemetry, or tracking of any kind).
- To assess site risk, when you visit a normal web page the extension sends that page's **registrable domain (e.g. `example.com`)** to a third‑party RDAP domain‑lookup service to retrieve the domain's registration date and registrar.
- **Only the registrable domain is sent** — the full URL, subdomains, path, query string, fragment, and page content are **never** sent.
- Registration data, settings, and your custom allow/block lists are stored **only locally in your own browser**.
- Removing the extension deletes all of its locally stored data.

### 1. What this extension does

Blue Ringed Octopus helps you identify possible phishing or scam sites by checking a domain's **registration age**, whether it belongs to a **high‑risk TLD / registrar**, and your custom allow/block lists. It warns you on the page via a banner or full‑screen overlay.

### 2. What data we process, and how

#### 2.1 Domains you visit (sent to third parties)

- When a tab finishes loading, the extension reads the tab's URL and extracts the **registrable domain (eTLD+1)**.
- Only if that domain is **not** in your allow list, block list, or the built‑in trusted‑TLD list, **and** there is **no valid local cache**, will the domain be sent to the following third‑party RDAP services to look up registration info:
  - `https://rdap.org/domain/{domain}` (an IANA bootstrap service that issues an HTTP 302 redirect to the RDAP server of the registry/registrar that actually manages the domain), and
  - for certain TLDs (currently `.me` `.io` `.sh` `.ac` `.bz`), a fallback request to `https://rdap.identitydigital.services/rdap/domain/{domain}` when the above returns no data.
- Through the redirect above, the queried domain name is also disclosed to the **registry/registrar RDAP server** for that domain. How those third parties handle the query is governed by their own privacy policies.
- **Only the registrable domain string is sent.** The full URL, subdomains, path, query string, fragment, cookies, form input, and page content are **never** transmitted.

**Pages that are never queried:** browser‑internal pages (`chrome://`, `about:`, extension pages, `file:`, `data:`, `view-source:`, etc.), `localhost`, private/reserved IP ranges, bare IP addresses, and dot‑less intranet hostnames are all skipped and are **never sent to any server**.

#### 2.2 Data stored locally on your device (never leaves your browser)

The following are stored only in your browser's `chrome.storage` and are never uploaded:

- **Domain lookup cache** (`chrome.storage.local`): queried registrable domains with their registration date, domain age, registrar, and fetch time, kept for **7 days** to reduce repeat lookups.
- **Your custom lists and settings** (`chrome.storage.local`): allow list, block list, warning‑threshold days, alert display preferences, your custom high‑risk‑TLD additions/removals, and UI language.
- **Current‑session statistics** (`chrome.storage.session`): only numeric counters (e.g., number of lookups / cache hits), containing no domains, and cleared when the browser closes.

#### 2.3 Access to web pages

- The content script is used solely to **inject warning banners/overlays** on the page. It does **not** read, collect, or transmit any page content, form data, or anything you type.
- To remember when you dismiss a "high‑risk TLD" warning (so it won't reappear for the same domain in the same tab), it writes a flag to that page's `sessionStorage`. This stays on that tab only and is never transmitted.

### 3. What we do NOT do

- We do not collect personally identifiable information such as name, email, account, password, or payment data.
- We send no data to the developer or to any analytics/advertising service (no telemetry, tracking pixels, or ad SDKs).
- We do not build, upload, or sell your browsing history.
- No account or sign‑in is required.

### 4. Third‑party services

When looking up domain registration data, the extension connects to the following third parties and discloses to them **the registrable domain being queried**:

| Service | Purpose | Data received |
|---------|---------|---------------|
| `rdap.org` | RDAP bootstrap / redirect | The queried registrable domain |
| The registry/registrar RDAP servers each domain redirects to (via `rdap.org`) | Provide registration data | The queried registrable domain |
| `rdap.identitydigital.services` | Fallback RDAP lookup for certain TLDs | The queried registrable domain |

These services are operated by third parties; their data handling is outside this extension's control. Please refer to their respective privacy policies.

### 5. Data retention and deletion

- The domain lookup cache is valid for **7 days**.
- You can **clear the cache** at any time from the extension's options/popup, and remove allow/block‑list entries yourself.
- **Removing (uninstalling) the extension** causes the browser to delete all of its locally stored data.

### 6. Children's privacy

This extension is not directed at children and does not collect any personal data.

### 7. Changes to this policy

If our data practices change, we will update this document and the "Last updated" date above. Material changes will be noted in the extension's update notes.

### 8. Contact

If you have questions about this Privacy Policy, please email **fraudhuntertw@gmail.com**, or open an issue on this project's GitHub repository.
