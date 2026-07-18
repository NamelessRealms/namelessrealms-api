/**
 * @file platform.types.ts
 * @description CF / Modrinth 瀏覽 proxy 的跨平台正規化型別（F13a-3）。
 *   兩個 platform-*.service 各自把上游回應收斂成同一形狀，controller 直接透傳。
 */

/** 依賴型別（僅保留 required / optional，其餘上游型別於正規化時丟棄） */
export type PlatformDepType = "required" | "optional";

/** 搜尋結果單筆（跨平台統一形狀） */
export interface PlatformSearchItem {
  source: "curseforge" | "modrinth";
  projectId: string;
  slug: string;
  name: string;
  author: string;
  description: string;
  iconUrl: string | null;
  downloads: number;
}

/** 版本清單單筆（含依賴，跨平台統一形狀） */
export interface PlatformVersion {
  versionId: string;
  name: string;
  fileName: string;
  size: number;
  date: string;
  mcVersions: string[];
  loaders: string[];
  dependencies: Array<{ projectId: string; type: PlatformDepType }>;
}

/** 批次專案資訊單筆（供依賴顯示名稱 / 圖示） */
export interface PlatformProject {
  projectId: string;
  name: string;
  slug: string;
  iconUrl: string | null;
}

/** from-platform 取得的檔案資訊（餵給進池管線的最小輸入） */
export interface PlatformVersionFile {
  /** CF fileId（數字）；Modrinth 不使用 */
  fileId?: number;
  fileName: string;
  /** CF 下載 URL，可能為 null（交由 pool 以 forgecdn 慣例重建） */
  downloadUrl?: string | null;
  /** Modrinth 檔案 sha256（CF 不使用，走 cf_file_hashes / 親算） */
  sha256?: string;
  /** Modrinth 直接下載連結 */
  url?: string;
  /** 檔案位元組數（Modrinth 有值；CF 進池時由親算取得） */
  size?: number;
}

/** loader 查詢參數（前端傳入的規範化大小寫） */
export type LoaderName = "Forge" | "Fabric" | "NeoForge" | "Quilt";