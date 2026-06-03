CREATE TABLE IF NOT EXISTS server_modpack_versions (
  id                VARCHAR(36)                                          NOT NULL PRIMARY KEY,
  server_id         VARCHAR(36)                                          NOT NULL,
  -- 綁定的子伺服器；NULL = 尚未指定（品牌層舊資料）。is_active 以「每個子伺服器一個」為單位
  sub_server_id     VARCHAR(36)                                          NULL,
  version_label     VARCHAR(100)                                         NOT NULL,
  mc_version        VARCHAR(20)                                          NOT NULL,
  modloader         ENUM('Vanilla','Forge','Fabric','NeoForge','Quilt')  NOT NULL,
  modloader_version VARCHAR(50)                                          NULL,
  notes             TEXT                                                 NULL,
  is_active         TINYINT(1)                                           NOT NULL DEFAULT 0,
  manifest_url      TEXT                                                 NULL,
  status            ENUM('draft','published')                            NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMP                                            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- draft 版本的檔案清單（JSON array），發布後清空；已發布版本檔案從 manifest_url 取得
  draft_files       MEDIUMTEXT                                           NULL,
  -- 快取的檔案數量，draft 時同步更新，發布時保留最後值
  file_count        INT                                                  NOT NULL DEFAULT 0,
  INDEX idx_server_id (server_id)
);

-- Migration（對已存在的資料庫執行一次）：
-- ALTER TABLE server_modpack_versions ADD COLUMN draft_files MEDIUMTEXT NULL;
-- ALTER TABLE server_modpack_versions ADD COLUMN file_count INT NOT NULL DEFAULT 0;
-- ALTER TABLE server_modpack_versions ADD COLUMN sub_server_id VARCHAR(36) NULL AFTER server_id;
--
-- 把現有 draft 版本的檔案列搬進 JSON 欄位：
-- UPDATE server_modpack_versions v
-- SET draft_files = (
--   SELECT COALESCE(
--     JSON_ARRAYAGG(JSON_OBJECT(
--       'id', f.id, 'version_id', f.version_id,
--       'file_name', f.file_name, 'dest_path', f.dest_path,
--       'file_url', f.file_url, 'file_hash', f.file_hash,
--       'file_size_bytes', f.file_size_bytes
--     )), '[]')
--   FROM server_modpack_files f WHERE f.version_id = v.id
-- )
-- WHERE v.status = 'draft';
--
-- 同步 file_count（draft 與 published 版本皆需）：
-- UPDATE server_modpack_versions v
-- SET file_count = (SELECT COUNT(*) FROM server_modpack_files f WHERE f.version_id = v.id);
--
-- 確認無誤後刪除舊表：
-- DROP TABLE server_modpack_files;
