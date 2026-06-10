# Blue-Ringed-Octopus

> **Blue-Ringed-Octopus** — Chrome Extension (Manifest V3)
>
> 偵測當前網站的網域註冊時間、TLD 與註冊商風險。年輕網域跳紅色橫幅、高風險 TLD 跳橘色提醒,並支援白/黑名單、可信 TLD 放行、五種狀態的工具列章魚 icon。

---

## 功能

- ✅ **自動偵測**:tab 載入完成時自動查詢註冊時間(RDAP)
- ✅ **告警橫幅**:小於門檻天數(預設 30,選項頁可調)的網域在頁面頂端顯示紅色橫幅,可手動關閉
- ✅ **可展開「為何被標記」**:橫幅 / 蓋版內可展開逐項證據(註冊 N 天 / 高風險 TLD / 高風險註冊商 / WHOIS 被遮罩)+ 白話「建議怎麼做」,落地 RDAP 已抓回卻原本沒呈現的 registrar / 遮罩訊號
- ✅ **加強告警(蓋版)**:可選用半透明全畫面蓋版取代頂端橫幅,較難忽略(預設關)
- ✅ **鎖定告警(無法忽略)**:勾選後,該類告警(黑名單 / 短註冊)在網頁與 popup 都無法關閉、略過或加入白名單,只能從選項頁解除(短註冊網域亦會在超過門檻天數後自動放行)。適合後輩幫長輩設定、防止在告警頁亂點忽略(預設關)。RDAP 暫時查不到時對短註冊鎖定採 fail-closed —— 無法確認年齡就不放行洗白
- ✅ **7 天本地快取**:`chrome.storage.local`,減少 RDAP 呼叫
- ✅ **智慧排除**:`chrome://`、`localhost`、私有 IP、純 IP 一律不查
- ✅ **多級 TLD 解析**:內建完整 Public Suffix List,正確處理 `example.com.tw`、`example.co.uk`、`x.github.io` 等
- ✅ **白名單 / 黑名單**:popup 一鍵加入 / 移出;選項頁完整管理 + 備份匯出(批次匯入目前僅黑名單;白名單要批次建立請走「備份 / 匯入」JSON)。所有輸入(含子網域 / 完整網址)都會自動化約成 registrable domain(eTLD+1)再存,與比對口徑一致
- ✅ **誤報一鍵「標記安全」**:告警橫幅 / 蓋版上一顆按鈕,點下即把該網域加白名單並移除告警(黑名單命中不提供,避免洗白);白名單可隨時在選項頁回收
- ✅ **可信 TLD 放行**:`.gov.tw` / `.edu.tw` / `.mil.tw` 直接放行不查
- ✅ **高風險 TLD 提醒**:`.xyz`、`.top`、`.click`、`.tk` 等常被釣魚濫用的 TLD 跳橘色橫幅;選項頁可自訂新增 / 停用內建項
- ✅ **偵測奇怪域名**(預設關):主域名(不含 TLD)超過 10 個字,或含連字號 `-` 時,於頁面頂端跳橘色提醒橫幅 —— 詐騙常用這類拼法假冒正牌網址。純文字結構判斷、不額外送出資料,亦無蓋版;IDN(`xn--`)略過以免誤報。選項頁開關
- ✅ **偵測子網域品牌偽裝**(預設開):子網域夾帶知名品牌字樣、但實際網域與該品牌無關時(如 `paypal.com.evil.xyz`,真正的網站是 `evil.xyz`)跳橘色提醒橫幅 —— 釣魚網址「看起來像官方」最常見的手法,且常用成熟 `.com` 網域,註冊時間訊號抓不到。內建約 40 個常被冒用品牌(台灣銀行 / 購物 / 繳費 / 電信與國際大站,見 `lib/brands.js`);只比對完整子網域段、品牌自家網域不誤判,一般詞品牌(LINE、Apple…)需出現 `.com`/`.tw` 等仿冒語境才提醒。純本地比對、不額外送出資料,亦無蓋版。選項頁開關
- ✅ **內建知名網站白名單**(預設開):內建約 2,900 個經真實流量驗證的網域(CrUX 台灣前 5,000 名 + 全球前 1,000 名,build 時經**七道過濾**:跨月持續性交集(殺輪替/拋棄式域名)、PSL 多租戶託管剔除、自家高風險 TLD 交叉剔除、內容類別過濾(成人/盜版/檔案空間/代理/無照賭博)、人工排除表(縮網址/開店平台/表單服務等)、165 涉詐名單交集、台灣人工種子,見 `scripts/build-allowlist.py`),命中即放行、**不送出 RDAP 查詢** —— 一次降低誤判面與隱私外洩。誠實揭露:(1) 命中時也會**跳過**品牌偽裝 / 奇怪域名偵測;(2)「在榜」代表流量與穩定性,**不是品質背書**;(3) 165 交集只防「建置當下已列管」的網域,新列管者要等下一版。使用者黑名單永遠優先(榜單可被操縱,不允許覆蓋使用者判斷);清單打包進版本、執行期零下載。選項頁開關
- ✅ **高風險註冊商提醒**:popup 對命中名單的 registrar 顯示「高風險」標記(不單獨觸發橫幅,僅供參考)
- ✅ **5 種狀態章魚 icon**:正常 / 紅色告警 / 橘色提醒 / 黑色(黑名單)/ 半透明(白名單 / 可信 TLD)
- ✅ **風險分數 badge**:工具列 icon 角落疊一個 0–100 粗略風險分數 + 顏色階(黑/紅/橘),不開 popup 就看得到當前頁的危險程度;安全 / 放行清空
- ✅ **節流統計**:選項頁顯示本次工作階段省下的 RDAP 查詢次數(瀏覽器關閉歸零)
- ✅ **預設放行**:RDAP 失敗 / 不支援時不顯示告警,降低誤殺
- ✅ **多語系**:繁體中文 / 英文,選項頁底部可切換;預設繁體中文
- ✅ **免造訪查詢台**:popup 可貼上任意網址 / 網域(例如 LINE / 簡訊收到的可疑連結),不必先點進去就能看註冊年齡 / TLD / 註冊商等風險訊號;偵測到短網址會明確標示「看不到最終目的地」。定位為**風險訊號查詢,非詐騙與否的判定**(沒有警示不代表安全)

## 隱私 / 資料外洩(務必先讀)

> 📄 完整隱私權政策(中英雙語):[privacy-policy.md](privacy-policy.md)

本擴充功能的核心機制就是把你造訪的網域送出去查詢註冊時間,這代表會有資料外洩到第三方。安裝前請評估自己是否能接受。

**會送出什麼**
- 每個 tab 載入完成、且不命中本地快取的網域:其 **registrable domain(eTLD+1)** 會被送出。例如 `https://foo.example.com/path?x=y` 只會送 `example.com`,不會送完整 URL、query string、或子網域。
- 你的 IP 位址(HTTP 連線必然帶)、User-Agent。

**送到哪裡**
- 主端點:`https://rdap.org/domain/{domain}`(IANA bootstrap)
- 它會 **HTTP 302 轉址** 到該網域的註冊商 RDAP server。實務上意味著你的 IP + 網域查詢會被 **rdap.org + 該網域的註冊商**(可能是 Verisign、Identity Digital、Tucows…等)同時看到。
- 內建 fallback:`.me / .io / .sh / .ac / .bz` **仍會先送 rdap.org**;只有當 rdap.org 對該網域回 404 時,才改打 `https://rdap.identitydigital.services/`。也就是說這些網域的查詢一樣會先經過 rdap.org。
- 程式碼參考:`lib/rdap.js`。

**已做的減量措施**
- 7 天本地快取:重複造訪同網域不會重新查
- 白名單 / 可信 TLD(`gov.tw` 等)/ 私有 IP / `localhost` / 黑名單命中 / `chrome://`:**完全不查 RDAP**
- 內建知名網站白名單(約 2,900 個 CrUX 高流量網域):命中**完全不查 RDAP** —— 日常瀏覽的大宗(銀行、電商、媒體)都不再外送查詢
- 只送 root domain,**不送完整 URL**
- 全程 HTTPS

**目前還沒做的(已知不足)**
- ❌ 沒有「無痕模式不查」開關 — incognito 視窗一樣會送出查詢
- ❌ 沒有自架 RDAP proxy / 域名雜湊 / 任何隱匿措施 — rdap.org 與註冊商能完整看到你查過哪些網域,進而推測瀏覽偏好
- ❌ 沒有「企業內網模式」 — 若你的工作流程涉及機敏網域,即使該網域是內網用、即將上線、或仍在保密階段,造訪時也會被送出

**建議使用情境**
- 個人/家用瀏覽,可接受 rdap.org 與註冊商看到你的網域查詢
- **不建議**用於:處理併購標的、未公開產品域名、敏感調查對象等場景

如果這項風險不可接受,請不要安裝;或改用本地 WHOIS / 自建 RDAP proxy 的版本(目前未提供)。

## 安裝(開發者模式)

1. Clone 或下載本專案
2. 開啟 Chrome 網址列輸入 `chrome://extensions`
3. 右上角開啟「開發人員模式」
4. 點「載入未封裝項目」
5. 選擇本專案根目錄(含 `manifest.json` 那一層)
6. 工具列會出現章魚 icon

## 使用

裝好就在背景自動運作,無需任何設定。

**檢查順序**(早期匹配即停止):
1. 排除規則(`chrome://` / `localhost` / 私有 IP)→ 完全不查
2. 黑名單命中 → 立即紅色告警
3. 白名單命中 → 放行(半透明 icon)
4. 可信 TLD 命中 → 放行(半透明 icon,不查 RDAP)
5. 內建知名網站白名單命中(若已啟用)→ 放行(半透明 icon,不查 RDAP)
6. RDAP 查詢 → 小於門檻 → 紅色告警;其餘狀態依高風險 TLD / 註冊商分派為橘色提醒或放行
7. 子網域品牌偽裝(若已開啟)→ 無紅色告警時,子網域夾帶品牌字樣則跳橘色提醒橫幅(訊息較具體,優先於高風險 TLD 橫幅;TLD 訊號仍以標籤與證據保留)
8. 奇怪域名(若已開啟)→ 上述都未告警時,主域名過長 / 含連字號則跳橘色提醒橫幅(最低優先)

**告警標籤**:
- 🔵 **可信 TLD** — 受嚴格管制的政府 / 教育 / 軍方 TLD
- 🔵 **知名網站** — 內建白名單(CrUX 真實流量榜經過濾)命中,直接放行不查 RDAP(預設開)
- 🟠 **高風險 TLD** — 命中內建清單時跳橘色橫幅;若同時 < 門檻則改紅色告警 + 加註標籤
- ⚫ **黑名單** — 使用者標記
- 🟢 **白名單** — 使用者信任
- ⚠️ **高風險註冊商** — popup 註冊商欄位旁的橘色提示,本身不彈橫幅
- 🟠 **奇怪域名** — 主域名(不含 TLD)> 10 字或含 `-`;最低優先,只在沒有其他告警時跳橘色提醒橫幅(預設關)
- 🟠 **品牌偽裝** — 子網域夾帶內建品牌字樣且 eTLD+1 非該品牌官方網域;特異性最高的橘色訊號,風險分數 60(預設開)

**Popup 操作**(精簡介面):
- 顯示當前網域狀態(註冊日期、已存在天數、註冊商、標籤)
- 「加入白名單 / 黑名單」按鈕(已在名單則切換為「移出」)
- **「🔎 查其他網址(免造訪)」**摺疊區 → 貼上任意網址 / 網域即查風險訊號,不必先造訪。短網址會警示看不到最終目的地;結果附「此為風險訊號查詢,非詐騙判定」說明
- 「開啟選項頁」連結 → 名單管理、門檻、蓋版、清單檢視、備份、語言切換

## 畫面

> 截圖待補。請放在 `docs/` 目錄下並以下列檔名引用。
> ⚠️ 截圖前務必檢查不要拍進工具列、瀏覽器大頭貼、書籤列、其他分頁等可洩漏個資的元素。

<!-- ![Popup 主介面](docs/screenshot-popup.png) -->
<!-- ![年輕網域紅色告警橫幅](docs/screenshot-warning.png) -->
<!-- ![選項頁](docs/screenshot-options.png) -->

| 畫面 | 說明 |
| --- | --- |
| _(待補)_ | Popup 主介面:網域狀態、註冊日期、標籤、加入名單按鈕 |
| _(待補)_ | 年輕網域的紅色告警橫幅 / 蓋版 |
| _(待補)_ | 選項頁:名單管理、門檻、清單檢視、備份、語言切換 |

## 選項頁

點 popup 底部連結,或 `chrome://extensions` 找到 BRO 點「擴充功能選項」。所有持久化設定都在這一頁:

- 白 / 黑名單(黑名單可批次匯入;皆支援一鍵備份匯出)
- 告警門檻天數
- 偵測奇怪域名開關(主域名過長 / 含連字號,預設關)
- 偵測子網域品牌偽裝開關(子網域夾帶品牌字樣,預設開)
- 內建知名網站白名單開關(命中直接放行不查 RDAP,預設開;附清單筆數與資料月份)
- 加強告警(蓋版)三個開關(黑名單 / 年輕網域 / 高風險 TLD)
- 鎖定告警(無法忽略)兩個開關(黑名單 / 短註冊;防長輩誤點關閉)
- 查詢快取清除
- 本次工作階段節流統計
- 高風險 TLD 清單(可自訂新增 / 停用內建)
- 可信 TLD 清單(內建,唯讀)
- 高風險註冊商清單(內建,唯讀)
- 介面語言(繁體中文 / 英文)

## 專案結構

```
.
├── manifest.json
├── _locales/
│   ├── en/messages.json
│   └── zh_TW/messages.json
├── background/
│   └── background.js          # MV3 Service worker (ES module)
├── content/
│   ├── content.js             # 橫幅 / 蓋版注入 (IIFE)
│   └── content.css
├── popup/
│   ├── popup.html             # 當前網域狀態 + 加入名單 + 開啟選項頁
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html           # 所有設定
│   ├── options.js
│   └── options.css
├── lib/                       # 共用模組
│   ├── domain.js              # extractRootDomain (PSL 演算法) / shouldSkip
│   ├── public-suffix-list.js  # PSL 規則集 (auto-generated)
│   ├── cache.js               # 7 天 TTL 快取
│   ├── rdap.js                # RDAP API client
│   ├── lists.js               # 白/黑名單 + 高風險 TLD / 註冊商 + 內建白名單查表
│   ├── brands.js              # 子網域品牌偽裝偵測(內建品牌 → 官方網域對照)
│   ├── allowlist.js           # 內建知名網站白名單(auto-generated)
│   ├── settings.js            # 門檻 / 蓋版 flag 存取
│   ├── stats.js               # 工作階段節流計數
│   └── i18n.js                # 自管 i18n(支援使用者切換)
├── scripts/
│   ├── build-psl.py           # 從 publicsuffix.org 重新產 PSL JS
│   ├── psl.dat                # 上次抓的 PSL 原始檔(可重抓取代)
│   ├── build-allowlist.py     # 從 CrUX 重新產內建白名單 JS(月更)
│   ├── allowlist-exclusions.txt # 白名單人工排除表(多租戶託管 / 縮網址)
│   └── tw-seed.txt            # 白名單台灣人工種子(公股行庫 / 超商 / 票證…)
├── icons/
│   ├── octopus-normal-{16,48,128}.png      # 正常
│   ├── octopus-alert-{16,48,128}.png       # 紅色告警(< 門檻)
│   ├── octopus-warn-{16,48,128}.png        # 橘色提醒(高風險 TLD / registrar)
│   ├── octopus-blacklist-{16,48,128}.png   # 黑色(黑名單)
│   ├── octopus-whitelist-{16,48,128}.png   # 半透明(白名單 / 可信 TLD)
│   └── generate.py            # icon 產生腳本
└── README.md
```

## 設定 / 調整

幾乎所有可調項目都在**選項頁**;以下是「進階使用者直接改 code」的入口。

### 切換 RDAP endpoint(目前:rdap.org)

預設使用免費、無需 API Key 的 `rdap.org`。換成 WhoisJSON 或自架 endpoint 請編輯 `lib/rdap.js`:

```js
const RDAP_ENDPOINT = "https://rdap.org/domain/";
```

需要時同時調整 `parseRegistrationDate` 的解析邏輯。

### Mock 模式(離線測試 UI)

`lib/rdap.js` 頂部:

```js
const USE_MOCK = false;  // 改 true 即可用假資料(5 天前註冊)
```

切換後重新載入 extension,任何網站都會跳告警,方便調 UI。

### 快取 TTL(預設 7 天)

`lib/cache.js`:

```js
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
```

> 「unsupported / error」結果**不**進 cache — 否則一次拿不到答案就會卡 7 天。

### Public Suffix List(eTLD+1 解析)

`lib/domain.js` 透過 `lib/public-suffix-list.js` 載入完整 PSL(ICANN + PRIVATE,合計約 10000 條規則,IDN label 已預先轉為 Punycode),支援 normal / wildcard(`*.foo`)/ exception(`!foo.bar`)三種規則。

**為什麼用 PSL**:早期版本是手工維護的 `MULTI_LEVEL_TLDS` Set(約 40 條,只涵蓋常見市場)。漏列的二級 TLD(例:`.co.il`、`.gov.eg`)會讓 `extractRootDomain()` 退回「最後兩段」,進而讓加在黑名單的網域被子網域繞過。改用 PSL 解掉這個漏洞。

**更新方式**:
```bash
curl -fsSL https://publicsuffix.org/list/public_suffix_list.dat -o scripts/psl.dat
python3 scripts/build-psl.py
```

`lib/public-suffix-list.js` 是 auto-generated,不要手改。`scripts/psl.dat` 與 `scripts/build-psl.py` 一起 commit,方便日後追溯與重建。

### 內建知名網站白名單(命中放行不查 RDAP)

`lib/allowlist.js` 由 `scripts/build-allowlist.py` 產生:

- **來源**:[CrUX(Chrome UX Report)](https://developer.chrome.com/docs/crux) 真實使用者流量榜 —— 台灣國別清單 rank ≤ 5000 + 全球清單 rank ≤ 1000,取自 [zakird/crux-top-lists](https://github.com/zakird/crux-top-lists) 月更快取。CrUX 資料授權 **CC BY 4.0**(依 Google BigQuery 官方 Kaggle listing 標示;另有來源標示為 CC BY-SA 4.0,如實註記此不一致)。
- **為什麼不用 Tranco**:Tranco 全球榜 100 萬筆中只有約 2,700 個 `.tw`,台灣銀行 / 政府網站名次落在 3.5 萬~16 萬名,任何常見截斷都會漏接;且其彙整清單無明文授權、預設混入 CC BY-NC 來源。
- **安全過濾**(榜單可被低成本操縱 —— Le Pochat et al., NDSS 2019,故一條都不能省):
  1. **跨月持續性交集**:當月與約五個月前都在榜才收 —— 殺掉輪替的盜版鏡像、帶日期戳的拋棄式域名、剛被操縱刷上榜的條目(實測一次砍掉約 800 筆);
  2. PSL PRIVATE 區段剔除多租戶託管域;
  3. **自家高風險 TLD 交叉剔除**(`.xyz`/`.top` 等上的高流量站不收 —— 否則白名單會反過來壓掉自己的橘色警示);
  4. 可信 TLD(gov.tw 等)死條目剔除(執行期它們在白名單之前就放行了);
  5. **內容類別過濾**(成人 / 盜版影視 / 匿名檔案空間 / 網頁代理 / 無照賭博):這些站的橘色提醒不是需要消除的誤判,綠色「知名網站」徽章與防詐定位衝突;
  6. `scripts/allowlist-exclusions.txt` 人工排除(PSL 沒收錄的多租戶平台、全部縮網址、開店平台、表單服務、link-in-bio、廣告落地頁輪替域);
  7. 與 [165 涉詐停止解析名單](https://data.gov.tw/dataset/176455) 交集剔除(含髒值清理;**種子被 165 點名直接建置失敗**)。
  `scripts/tw-seed.txt` 最後併入台灣人工種子(公股行庫 / 超商 / 票證等)。
- **語意限制**:白名單只負責「放行 + 不查 RDAP + 不跑品牌偽裝/奇怪域名偵測」,**永遠不覆蓋使用者黑名單**(`evaluateDomain` 短路順序保證);比對僅限 eTLD+1 完全相符。
- **殘餘風險(誠實揭露)**:「在榜」代表真實流量與跨月穩定,不是品質背書;165 交集只防建置當下已列管者,新列管網域有最長一個版本週期的空窗(該網域屆時多已被停止解析,實害有限);儲存層故障的降級模式下黑名單讀取失敗會 fail-open 而內建白名單仍生效(極端情境,接受)。

**更新方式**(CrUX 每月第二個週二後發布新資料):
```bash
python3 scripts/build-allowlist.py        # 自動抓最新月份;健檢失敗會直接報錯
```

`lib/allowlist.js` 是 auto-generated,不要手改;排除表與種子檔進版控,逐筆附理由。

### 可信 TLD 清單(白名單放行)

`lib/lists.js` 的 `TRUSTED_TLDS` Set。命中此清單直接放行(不查 RDAP),popup 顯示藍色「可信 TLD」標籤。

收錄原則:只收本專案能明確背書的台灣 TLD。目前只有 `gov.tw` / `edu.tw` / `mil.tw`。

**刻意不收錄**:
- 其他國家政府 / 教育 TLD(`gov.uk`、`go.jp`、`gov.cn`)— 各國核發政策不一,保守不收
- 美國單段管制 TLD(`gov`、`mil`、`edu`、`int`、`bank`、`insurance`)— 同上
- `.museum`、`.aero`、`.post`、`.pharmacy`(管制但不等於資安可信)
- `.ac`(單段是 Ascension Island ccTLD,不是學術)
- `.org`、`.com`(任何人可註冊)

⚠️ 即使政府網站也可能被入侵(子網域接管、第三方服務被駭),可信 TLD 只是降低釣魚機率,不代表絕對安全。

### 高風險 TLD 清單

兩層:

1. **內建** — `lib/lists.js` 的 `HIGH_RISK_TLDS` Set(~36 個依 Spamhaus 2024-2025 報告挑選的高濫用 gTLD / ccTLD,例 `.xyz`、`.top`、`.cyou`、`.click`、`.tk`、`.ml`)
2. **使用者覆寫** — `chrome.storage.local` 的 `user_high_risk_tlds_add` / `user_high_risk_tlds_remove`,從**選項頁**直接增刪:
   - 加入:選項頁「高風險 TLD」區輸入框 → Enter
   - 停用誤殺率高的內建項:點該 chip 右側 `✕`;收進「已停用的內建 TLD」摺疊區,可一鍵 ↻ 還原

有效清單 = `(內建 ∪ 自訂) − 停用`。後續若調整內建清單,使用者自訂仍會保留。

**告警策略**:命中跳橘色提醒橫幅(與紅色告警橫幅區分嚴重度);同分頁同 domain 按 X 關閉後 `sessionStorage` 記憶,本分頁不再彈。若同時 < 門檻,改為紅色告警 + 加註「高風險 TLD」標籤。

> 想再看到關閉過的提醒:**關掉該分頁、開新分頁到同網站**即可(重新整理不會清除 sessionStorage,需新分頁)。

### 高風險註冊商清單

`lib/lists.js` 的 `HIGH_RISK_REGISTRARS` Set(內建,目前約 20 家)。命中時 popup 在 registrar 欄位旁顯示橘色「高風險」標記,**不單獨觸發橫幅**(清單具爭議性,避免誤殺)。

要編輯請直接改該 Set;選項頁的清單區塊只是檢視。

### 白名單 / 黑名單

存在 `chrome.storage.local.whitelist` / `.blacklist`(陣列)。

- **單筆加入 / 移出**:popup 一鍵切換,或選項頁手動輸入
- **批次匯入(僅黑名單)**:選項頁**黑名單卡片**的「批次匯入…」摺疊區,支援一行一個或逗號分隔、`#` 開頭視為註解;白名單要批次建立請走「備份 / 匯入」JSON。有失敗項目時會保留在輸入框並以紅色提示,方便修正後重試
- **備份 / 跨機同步**:選項頁的「備份 / 匯入」區可下載 JSON;在新機器上匯入即可

舊版本透過 DevTools 直接寫 storage 的方式仍可用,但 UI 已能涵蓋大多數需求。

## 已知限制

- **部分 ccTLD 不支援 RDAP**:例如某些 `.cn` 網域會被歸類為 `unsupported`,預設放行(不告警)
- **SPA 路由切換不重新觸發**:本擴充功能依賴 `chrome.tabs.onUpdated` 的 `complete` 狀態,純前端路由(pushState)不會重新檢查。同網域內切換不需要重查也合理(root domain 不變)
- **API 速率限制**:rdap.org 未公開明確 rate limit。配合 7 天本地快取,個人瀏覽通常不會觸發
- **manifest description 不跟使用者語系切換**:Chrome 平台限制 — 選項頁的「介面語言」只影響 extension UI;`chrome://extensions` 上的描述固定走瀏覽器 UI 語言(`default_locale` 是 `zh_TW`)
- **已開啟的分頁切換語言不會即時更新**:已 render 的橫幅 / 蓋版保持舊語言,需重新整理才更新

## 重新產生 icon

```bash
python icons/generate.py
```

純 Python stdlib,無需 PIL / Pillow。

## 打包 / 發布

產生可上架 Chrome Web Store 或供他人 sideload 的乾淨 `.zip`:

```powershell
pwsh scripts/package.ps1
# 或附 README：pwsh scripts/package.ps1 -IncludeReadme
```

- 版本號自 `manifest.json` 讀取,輸出 `dist/blue-ringed-octopus-v<version>.zip`
- 採**白名單**策略,只收 extension 執行期真正需要的檔(manifest / background / content / popup / options / lib / `_locales` / `icons/octopus-*.png`)
- 自動排除建置工具(`scripts/`、`icons/generate.py`)、未引用資源(`icons/icon16.png`)、暫存檔(`*.tmp.*`)、誤建副本、以及任何個人 / 內部資料
- staging 在系統暫存目錄進行,避免 Dropbox / OneDrive 等同步軟體在壓縮時鎖檔

## 授權

私人專案,未指定授權條款。
