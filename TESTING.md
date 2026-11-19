# v23 Pages 驗證紀錄

驗證日期：2026-11-19（台北）
基準：桌面 v22；未改寫或覆蓋該版本。

| 項目 | 結果 | 說明 |
| --- | --- | --- |
| Build／封裝 | PASS | 純靜態檔案，不需編譯；入口／本地 import 路徑檢查與 ZIP 完整性通過 |
| JavaScript 語法 | PASS | `npm run check`，6 個模組全部通過 `node --check` |
| Type Check | NOT RUN | 未加入 TypeScript／型別檢查 dependency |
| Unit／Static Tests | PASS | `npm test`：17 tests passed |
| HTTP Startup | PASS | 本機靜態 HTTP 服務啟動，index 與 8 個核心資源均回傳 200 |
| HTML 結構 | PASS | lxml 解析，入口、main、module script、file controls 檢查 |
| ZIP Smoke Test | PASS | 實際執行 JS buildZip，產生 ZIP 後由 unzip 與 Python zipfile 獨立驗證 CRC、UTF-8 中文檔名與內容 |
| Browser Startup | FAIL（環境限制） | 曾嘗試啟動 Playwright Chromium，但執行環境回報 `socket() failed: Operation not permitted`，瀏覽器未能啟動；未繞過限制 |
| Browser Image／UI Smoke | NOT RUN | 因瀏覽器無法啟動，未實際執行 Canvas 轉檔、下載 UI、手機畫面及 CORS 雙站點整合測試 |
| GitHub Pages 實際發布 | NOT RUN | 未提供 Repository，且未授權寫入遠端；交付部署包與說明，不宣稱已上線 |
| 真正 API 上架 | NOT RUN／OUT OF SCOPE | 無假的上架成功或公開密鑰 |

## 17 項已通過的測試

1. 靜態入口資源存在且使用子路徑相容 URL。
2. UI 元件 ID 唯一，JS 所用固定 ID 都已定義。
3. JS imports 都指向本地存在模組，沒有 CDN／Python bridge。
4. CSP 禁止外來腳本，來源資料不注入 live innerHTML。
5. 預設 keep，壓縮／標準化關閉，多張 ZIP 開啟。
6. 無效／舊設定回復為合法白名單值。
7. 網址僅允許 HTTP(S)，拒絕內嵌帳密。
8. Windows 安全檔名與大小寫不分的重複檔名處理。
9. HTML 跳脫與 CSV 公式注入防護。
10. PNG／JPEG／WebP magic bytes 與 HTML 非圖片拒絕。
11. jpg/jpeg 格式篩選等價。
12. CRC32 標準向量與 UTF-8 ZIP。
13. ZIP traversal／磁碟路徑／重複項目拒絕。
14. Fetch 不帶 credentials、保留回應內容及最終網址。
15. HTTP／網路錯誤不會變成成功資料。
16. 取消讀取與匯入資源缺檔錯誤。
17. 宣告大小或串流大小超過上限時拒絕。

網路單元測試使用隔離 Fetch fixture，不代表真實網站 CORS 已通過。

## 已附但未執行的瀏覽器整合測試

`tests/browser.test.mjs` 包含：Repository 子路徑啟動、原格式逐位元保留、錯誤副檔名／MIME 修正、JPEG／PNG／WebP 實際轉檔、設定重新載入、ZIP 內容及 CRC、空選取、標準化／智慧命名／QA、假圖片排除、批次分資料夾、CORS 拒絕、不執行匯入腳本、資訊報告／sitemap、鏡像 CSS 改寫、取消、無效本機檔案、手機導覽、localStorage 失敗提示。

此檔目前是待執行測試，不算通過。建議正式部署後先測：

1. 匯入一張 PNG（故意命名 .jpg），原格式下載應為 .png，內容應保持一致。
2. 分別指定 JPEG／PNG／WebP，關閉壓縮也必須產生真正格式。
3. 匯入多張圖片下載 ZIP，確認解壓、檔名與每張格式。
4. 測一個允許 CORS 的網址與一個拒絕的網址；拒絕時不可顯示成功。
5. Ctrl+F5 重新載入與手機操作。

## Code Review／相容性

- 桌面 v22 ZIP 未修改，Pages 作為獨立 v23 交付。
- 未增加執行期 dependency；必要重寫限於 Python／WebView 無法在 Pages 執行的部分。
- 未變更／呼叫原 API；不移植帳密與 Pydantic 路徑驗證至公開網頁。
- 已檢查 Caller、來源路徑、設定讀寫、格式 MIME／副檔名、ZIP Reader／Writer、重複事件、取消、物件 URL 釋放、匯入競態及錯誤顯示。
- 已修正檔名開頭點、鏡像圖片副檔名、無副檔名 CSS／JS 資源、缺 canonical、HTML 匯入時的操作競態、QA 縮圖失敗不應使已儲存圖片失敗，以及遞迴失敗無限嘗試風險。
- 已知平台限制：CORS、瀏覽器解碼格式、記憶體、登入／動態 API、SSL 細節與任意磁碟寫入；詳見 README。
- 尚未完成瀏覽器層級驗證，因此不能宣稱所有 UI／Canvas 與真實網站整合都已通過。
