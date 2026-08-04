/**
 * @file version.ts
 * @description 定義 API 當前版本號，供 environment 與 status 端點使用
 *
 * 本檔由 `yarn outputVersion`（scripts/gen-version.js）自動產生，
 * 版本號來自 package.json 的 `version` 欄位。
 * ⛔ 請勿手動編輯——要改版本號請改 package.json，再重新執行 `yarn outputVersion`。
 */
export const API_VERSION = "1.6.2";
