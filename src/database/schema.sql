-- ============================================================
-- schema.sql — 依 FK 相依順序建立所有資料表
-- ============================================================
-- 用法（務必在本目錄下執行，SOURCE 走相對路徑）：
--   cd src/database
--   mysql -u <user> -p <dbname> < schema.sql
--
-- 全部為 CREATE TABLE IF NOT EXISTS，可對既有庫重覆執行不覆蓋。
-- ============================================================

-- ── 獨立表（無外鍵）────────────────────────────────────────
SOURCE users.sql;
SOURCE verification_codes.sql;
SOURCE revoked_refresh_tokens.sql; -- F35 撤銷檢查為 fail-closed，缺表則所有 refresh 一律 401
SOURCE api_keys.sql;
SOURCE minecraft_accounts.sql;
SOURCE dashboard_user_roles.sql;
SOURCE user_link.sql;
SOURCE sponsor_userlist.sql;
SOURCE violationlist.sql;
SOURCE awaitVerify_whitelist.sql;
SOURCE manualVerify_whitelist.sql;
SOURCE tpme_verify_whitelist.sql;
SOURCE server_whitelist.sql;
SOURCE mod_metadata.sql;         -- 池物件 sha256 → jar metadata（無 FK）

-- ── 伺服器相依鏈（外鍵，需照順序）──────────────────────────
SOURCE servers.sql;             -- 品牌層根表
SOURCE server_roles.sql;        -- → servers
SOURCE server_members.sql;      -- → servers, server_roles
SOURCE server_media.sql;        -- → servers
SOURCE server_sub_servers.sql;  -- → servers
SOURCE sub_server_media.sql;    -- → server_sub_servers
SOURCE server_modpack.sql;      -- server_modpack_versions（僅 index，無 FK）
SOURCE modpack_file_refs.sql;   -- → server_modpack_versions（池引用計數）
SOURCE cf_file_hashes.sql;      -- CF fileId → 後端親算 sha256 快取（無 FK）
