/**
 * @file curseforge-url.ts
 * @description CurseForge API 有時回傳 null 的 downloadUrl；依 forgecdn 慣例重建直接下載 URL
 * @notes 純函式、無副作用，可獨立單元測試
 */

const FORGECDN_BASE_URL = "https://edge.forgecdn.net";

/**
 * Fix CurseForge API downloadUrl null issues.
 * 依 forgecdn 慣例重建直接下載 URL：`/files/{fileId 前 4 碼}/{餘碼去前導零}/{檔名}`。
 * 已對真實 CDN 案例驗證（如 fileId 3215435 → /files/3215/435/、2926027 → /files/2926/27/）。
 *
 * ⚠️ 2026-07-16 起 edge.forgecdn.net 強制 API key——呼叫端下載時須帶 `x-api-key` header，本函式僅組 URL。
 *
 * @param fileId CurseForge 檔案 ID（至少 5 位數）
 * @param fileName 原始檔名（本函式內會做 URL encode，呼叫端傳原始檔名即可）
 * @returns 重建的 forgecdn 直接下載 URL
 * @throws {Error} fileId 非至少 5 位數的正整數時
 */
export function flxCurseforgeDownloadUrlNullIssues(
  fileId: number,
  fileName: string
): string {
  const idStr = String(fileId);
  if (!/^\d{5,}$/.test(idStr)) {
    throw new Error(`Invalid CurseForge fileId: ${fileId}`);
  }

  const part1 = idStr.slice(0, 4);
  const part2 = String(parseInt(idStr.slice(4), 10)); // 去前導零；全零 → "0"，不會產生空段

  return `${FORGECDN_BASE_URL}/files/${part1}/${part2}/${encodeURIComponent(fileName)}`;
}
