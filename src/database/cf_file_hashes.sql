-- ============================================================
-- cf_file_hashes — CurseForge fileId → 後端親算 sha256 快取
-- ============================================================
-- 依賴 CF fileId 不可變性：同一 fileId 內容永不變，故 sha256 可長期快取。
-- 命中即可零下載直達 sha256（配合池的 headObject 幾乎必命中）。
-- 信任鏈：每筆皆為後端親算，不接受任何客戶端自報的 hash。
CREATE TABLE IF NOT EXISTS `cf_file_hashes` (
  `cf_file_id` BIGINT      NOT NULL PRIMARY KEY,            -- CurseForge 檔案 ID
  `sha256`     VARCHAR(64) NOT NULL,                        -- 後端親算的內容雜湊
  `file_size`  BIGINT      NOT NULL                         -- 位元組數（親算時一併記錄）
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
