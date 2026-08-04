/**
 * @file gen-version.js
 * @description 產生 src/version.ts。以 fs.writeFileSync 輸出「含 JSDoc 檔頭的完整檔案」，
 *              取代原先 package.json 內只印出 export 一行的 one-liner——那個做法每次 build
 *              都會把已 commit 的檔頭註解吹掉，造成 git status 出現假髒檔。
 *              檔頭含中文，故用獨立腳本檔而非 shell 字串，避免引號與編碼陷阱。
 */

const fs = require("fs");
const path = require("path");

const { version } = require("../package.json");

const outputPath = path.join(__dirname, "..", "src", "version.ts");

const content = `/**
 * @file version.ts
 * @description 定義 API 當前版本號，供 environment 與 status 端點使用
 *
 * 本檔由 \`yarn outputVersion\`（scripts/gen-version.js）自動產生，
 * 版本號來自 package.json 的 \`version\` 欄位。
 * ⛔ 請勿手動編輯——要改版本號請改 package.json，再重新執行 \`yarn outputVersion\`。
 */
export const API_VERSION = ${JSON.stringify(version)};
`;

fs.writeFileSync(outputPath, content);
