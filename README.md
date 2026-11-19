# Site Audit Tool v23 — GitHub Pages 版

以已正常運作的桌面版 v22 為基準，移植成 HTML／CSS／JavaScript 靜態版。
原 Python 專案與桌面 v22 不會被覆寫。此包可直接放 GitHub Pages，無需 npm install、Python 後端、CDN 或 API Key。

## 部署（建議新建 Repository）

1. 解壓 `拔站小工具_v23_Pages.zip`。
2. 把解壓後的**內容**上傳到 Repository 根目錄，讓 `index.html` 與 `assets/` 位於同一層；不要只上傳 ZIP，也不要多包一層資料夾。
3. 按 **Commit changes**。
4. 到 **Settings → Pages → Build and deployment**，Source 選 **Deploy from a branch**。
5. Branch 選 **main**，資料夾選 **/(root)**，按 **Save**。
6. 等 GitHub Pages 部署成功，再開啟該頁面顯示的網站連結。

靜態資源全部使用 `./assets/...` 相對路徑，支援 `https://帳號.github.io/Repository名稱/`。
若使用 `/docs` 發布，則將內容放在 `docs/`，並將 Pages 資料夾改為 `/docs`。
`.nojekyll` 請保留；不需自訂 GitHub Actions。

尚未替你發布或修改任何遠端 Repository。部署前請不要把私人網站原始碼、擷取結果、帳密或 API Key 一起上傳。

### 後續更新

以新版 `index.html` 與整個 `assets/` 同步覆蓋舊檔後 Commit。不要只換 index 而保留舊 JS。
等部署成功後用 Ctrl+F5 重新載入。本版沒有 Service Worker，不會自行快取舊版。
要保留舊版，可存放在獨立的 `versions/v23/`；新版仍發布於根目錄，兩者不共用 assets。

## 使用方式

### A. 網址擷取

1. 選擇資訊擷取、靜態鏡像或圖片擷取。
2. 「讀取方式」選網址，填入完整網址。
3. 若為批次，勾選「批次多頁」，每行一個網址。
4. 執行後下載報告／ZIP，或在圖片選取器選圖再下載。

**前提：目標網頁與圖片主機必須允許你的 GitHub Pages 網域跨站讀取（CORS）。**
網頁能在新分頁打開，不代表 JavaScript 能讀取內容。網址正確仍可能被 CORS、登入、防盜連、反爬、網路、憑證或 Mixed Content 阻擋。
工具不使用 `no-cors` 假讀取、不繞過驗證、不代送 Cookie，也不使用第三方公共 Proxy。

### B. 網站未允許 CORS（推薦的無後端替代操作）

1. 在原網站開啟目標頁，以 Ctrl+S 另存為「網頁，完整」。
2. 在本工具選「貼上／匯入 HTML」，匯入另存的 `.html`。
3. 若原始碼使用相對路徑，在上方填入原網址。
4. 用「匯入資源資料夾」加入另存的圖片／CSS 等資料夾，或加入對應本機圖片。
5. 執行擷取。已匯入的資源優先讀本機，不會上傳。

也可在原網站按 Ctrl+U 複製原始碼後貼上，但圖片仍須允許 CORS，或另外匯入對應本機檔案。
若瀏覽器改寫了檔名，本工具會依完整路徑／唯一檔名配對；無法配對或有多個同名檔會明確失敗，不會亂配。
由 JavaScript 執行後才出現的內容，不一定在原始 HTML 中，需用網站實際另存內容或桌面版處理。

### C. 本機圖片轉檔

1. 選圖片擷取 → 本機圖片轉檔。
2. 加入圖片或資料夾。
3. 設定輸出原格式／JPEG／PNG／WebP，執行後選圖下載。

## 圖片格式保證

- 預設 `output_format = keep`，且壓縮與標準化關閉：逐位元保留原始資料，只依真正格式更正副檔名。
- 不相信網址與 HTTP MIME；檢查 magic bytes，再使用瀏覽器圖片解碼器驗證。
- 明確指定 JPEG／PNG／WebP：即使未勾選壓縮，也會用 Canvas 真正重新編碼。
- 轉檔後再檢查實際輸出格式。若瀏覽器把不支援格式退回 PNG，不會把該內容假稱成 JPEG／WebP。
- JPEG 透明處以白底處理；PNG／WebP 可保留透明度；標準化為 1:1 白底。
- 原格式 GIF 不經 Canvas 壓縮，避免動畫被默默截為第一幀。明確轉成 JPEG／PNG／WebP 或標準化會產生靜態畫面，執行記錄會提示。
- TIFF、部分 AVIF／ICO 或超大圖片若瀏覽器不能解碼，會拒絕輸出並建議使用桌面版。
- 多張預設 ZIP。若有 CSV／QA／失敗附件，也會包 ZIP；沒有附件的單張直接下載。
- 原格式＋啟用壓縮不是「不重新編碼」；品質與最大寬度於啟用壓縮時套用。

## 相容性與明確限制

| 桌面 v22 功能 | Pages v23 |
| --- | --- |
| 深淺色、模式分區 | 保留，並補手機導覽 |
| Meta／標題／連結／圖片／表格／表單／JSON-LD | 本機 HTML 或 CORS 來源可分析；原 JSON 欄位結構盡量保留 |
| JSON／CSV／HTML／原始碼輸出 | 瀏覽器下載；原始碼另有安全的純文字／跳脫檢視版 |
| robots／sitemap | 網址模式嘗試讀取，失敗記錄；匯入模式標記未執行 |
| 單頁／批次圖片、轉檔、壓縮、ZIP | 保留，受來源 CORS 與瀏覽器解碼器限制 |
| 智慧命名、bulk_import.csv、白底方形、QA | 保留；CSV local_path 為 ZIP 相對路徑，不是電腦絕對路徑 |
| 完整鏡像、CSS 資源下載與改寫 | 改為「有限靜態鏡像」；最多 50 頁／300 資源，可能仍有外連資源 |
| 指定電腦任意輸出資料夾 | 瀏覽器控制下載位置，無法任意寫入磁碟 |
| config.json | 改為此瀏覽器 localStorage；無效／無權限時有提示 |
| SSL 憑證到期、TLS 細節、SSL 降級 | 不支援，不會以 HTTPS 字樣假裝憑證檢查通過 |
| 登入 Session、Cookie、防爬處理 | 不支援；請用桌面版 |
| 真實 API 上架、API Key、ProductIR Pydantic 管線 | 不移植；不顯示假的成功，不把密鑰放公開前端 |
| 動態頁面、API／資料庫、JS 執行後抓取 | 不屬於純靜態鏡像；請用桌面版或另有授權的後端 |

GitHub Pages 不提供後端，因此無法讓「任意網址一貼就完整抓站」等同桌面版。
如需保留任意網址、登入與完整鏡像能力，必須另外部署受保護後端；此版沒有偷偷串接公共代理或要求其他帳號。

## 保護與資源上限

- 不將匯入 HTML 放進目前頁面的 innerHTML；不在工具中執行外來腳本。
- 顯示及報告內容跳脫 HTML，CSV 防公式注入，ZIP 拒絕 traversal／磁碟路徑。
- 原始網站鏡像仍可能包含原站腳本，只開啟可信來源；工具不預覽執行這些腳本。
- 不儲存來源網址、照片、帳密、Token 或 Cookie 至 localStorage；只儲存白名單偏好設定。
- 不要求讀取你的 GitHub Token，Repository 上傳請用 GitHub 自己的介面。
- 每檔最多 30 MB、圖片最多 500 張、工作資料上限 250 MB、解碼畫布上限 4,000 萬像素。
- 網路讀取逾時 30 秒；可取消網路／逐檔工作。單次瀏覽器編碼需等該張處理完成。
- 失敗不會偽裝成功；沒有有效圖片時不下載空成功檔。

## 本機開發與測試

發布與操作不需要 npm。以下僅供維護：
不要直接以檔案總管雙擊 `index.html`（`file://` 會限制 ES module）；請透過 GitHub Pages 或下列本機 HTTP 服務開啟。

```bash
python3 -m http.server 8080
# 開啟 http://localhost:8080/
npm run check
npm test
```

`npm test` 使用 Node.js 內建 test runner，無需安裝套件。
瀏覽器測試 `tests/browser.test.mjs` 需開發環境另有 Playwright 與 Chromium：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs CHROMIUM_PATH=/path/to/chromium node tests/browser.test.mjs
```

測試以兩個本機 HTTP Origin 模擬 CORS 許可／拒絕，不向外部服務送測試資料；測試內容包含下載、轉檔、ZIP、HTML 匯入、報告、鏡像、取消與手機版。
實際執行狀態請看 `TESTING.md`，未執行項目不視為通過。

## 架構與修改範圍

- `index.html`：靜態入口／模式／匯入／設定／選圖 UI。
- `assets/legacy.css`：自 v22 主介面擷取的原樣式。
- `assets/pages.css`：僅補瀏覽器匯入、選圖及手機導航樣式。
- `assets/app.js`：事件 → 來源讀取 → 模式流程 → 預覽 → 匯出。
- `assets/parser.js`：對應 scraper.py、image_picker.py 的 DOM 解析與商品資訊。
- `assets/images.js`：對應 v22 圖片內容辨識、壓縮與標準化；用瀏覽器編碼取代 Pillow。
- `assets/zip.js`：沿用 v22 的 MiniZip STORE／CRC32 設計，支援 UTF-8 中文檔名。
- `assets/mirror.js`：可讀取資源的有限靜態鏡像及相對路徑改寫。
- `assets/utils.js`：白名單設定、錯誤、網路 timeout、檔名／報告／CSV 共用工具。
- `tests/`：不會在正式頁面載入的測試。

MUST：靜態可發布、原格式預設、真實轉檔、不假成功、明確 CORS 限制、保留 v22 桌面來源。
SHOULD：手機可操作、匯入無後端替代路徑、失敗清單、部署說明與回歸測試。
OUT OF SCOPE：代替你建立／發布 GitHub repo、繞過 CORS、公共代理、帳號登入擷取、真正 API 上架、任意站點完整動態鏡像。

官方參考：
- https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS
