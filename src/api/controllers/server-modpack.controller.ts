/**
 * @file server-modpack.controller.ts
 * @description 伺服器模組包版本管理：建立/匯入版本、管理檔案、發布 manifest、設定 active 版本
 *
 * 檔案儲存架構：
 *   - Draft 版本：檔案清單存在 server_modpack_versions.draft_files（JSON TEXT）
 *   - Published 版本：draft_files 保留全量 authoring record（含停用項 disabled:true）；
 *     manifest_url（S3 JSON）僅含啟用中（enabled）條目，供玩家下載
 *   - server_modpack_files 表已廢棄，不再使用
 *   - entry disabled 旗標（F13a-1）：停用項不進 manifest（玩家不下載），但留存於
 *     draft_files 跨版本持久（發布留存、衍生帶回、可再啟用）；讀取端一律補 disabled:false
 *
 * @methods
 *   - getVersions: 取得版本列表（含 file_count）；可用 ?subServerId 篩選
 *   - createVersion: 從零建立新版本（只傳 metadata，可選綁定 sub_server_id）
 *   - importVersion: 匯入 CurseForge/Modrinth 模組包並解析檔案（可選綁定 sub_server_id）
 *   - updateVersion: 更新版本 metadata
 *   - deleteVersion: 刪除版本（active 版本不可刪）
 *   - activateVersion: 設為目前版本（is_active 以子伺服器為單位）
 *   - getActiveModpackForSubServer: 取某子伺服器啟用中的版本（供啟動流程取 manifest）
 *   - publishVersion: 產生 manifest.json（僅 enabled）上傳 S3；draft_files 保留全量
 *   - deriveVersion: 從 published 版本 copy-on-write 衍生新草稿（複製基底 draft_files，含 disabled）
 *   - getFiles: 取得版本的檔案列表（優先讀 draft_files；published 舊版本空值才 fallback manifest）
 *   - addFile: 上傳單一檔案到版本（只允許 draft；同 dest_path 為替換語意）
 *   - removeFile: 從版本移除檔案（只允許 draft，不刪 S3）
 *   - restoreFile: 從基底版本還原單一檔案 entry 回草稿（涵蓋還原修改與還原刪除）
 *   - updateFilePolicy: 更新草稿內單一檔案的 policy（enforced ⇄ default）
 */
import crypto from "crypto";
import path from "path";
import AdmZip from "adm-zip";
import { Request, Response } from "express";
import Mysql from "../utils/mysql";
import { uploadToS3 } from "../utils/s3/s3";
import { config } from "../../config/config.service";
import {
  createImportLimiter,
  ensureBufferInPool,
  ensureCurseforgeFileInPool,
  ensureModrinthFileInPool,
  PoolResolveError,
} from "../utils/modpool/pool";
import ModsService from "../services/mods/mods.service";
import PlatformCurseforgeService from "../services/mods/platform-curseforge.service";
import PlatformModrinthService from "../services/mods/platform-modrinth.service";
import { captureModMetadata } from "../services/mods/mod-metadata.service";

const modsService = new ModsService();
const platformCurseforgeService = new PlatformCurseforgeService();
const platformModrinthService = new PlatformModrinthService();

/** 取得伺服器所有模組包版本（含每版本的檔案數量）；可用 ?subServerId 篩選某子伺服器 */
export async function getVersions(req: Request, res: Response): Promise<void> {
  const { serverId } = req.params;
  const subServerId = req.query.subServerId as string | undefined;

  const [rows]: any = subServerId
    ? await Mysql.getPool().query(
        "SELECT * FROM server_modpack_versions WHERE server_id = ? AND sub_server_id = ? ORDER BY created_at DESC",
        [serverId, subServerId]
      )
    : await Mysql.getPool().query(
        "SELECT * FROM server_modpack_versions WHERE server_id = ? ORDER BY created_at DESC",
        [serverId]
      );
  const versions = (rows as any[]).map(({ draft_files: _df, ...r }) => ({
    ...r,
    is_active: r.is_active === 1,
    file_count: Number(r.file_count),
  }));
  res.json(versions);
}

/** 建立新的模組包版本（只含 metadata，status = draft） */
export async function createVersion(req: Request, res: Response): Promise<void> {
  const { serverId } = req.params;
  const { version_label, mc_version, modloader, modloader_version, notes, sub_server_id } = req.body;

  if (!version_label?.trim() || !mc_version?.trim() || !modloader?.trim()) {
    res.status(400).json({ message: "version_label、mc_version、modloader 為必填" });
    return;
  }

  const id = crypto.randomUUID();
  await Mysql.getPool().query(
    `INSERT INTO server_modpack_versions
       (id, server_id, sub_server_id, version_label, mc_version, modloader, modloader_version, notes, draft_files, file_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0)`,
    [id, serverId, sub_server_id ?? null, version_label.trim(), mc_version.trim(), modloader, modloader_version ?? null, notes ?? null]
  );

  const [rows]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ?",
    [id]
  );
  const { draft_files: _df, ...row } = rows[0];
  res.status(201).json({ ...row, is_active: false, file_count: 0 });
}

/** 匯入 CurseForge zip 或 Modrinth mrpack，自動解析 metadata 與檔案 */
export async function importVersion(req: Request, res: Response): Promise<void> {
  const { serverId } = req.params;
  const { sub_server_id } = req.body;

  if (!req.file) {
    res.status(400).json({ message: "請上傳 .zip 或 .mrpack 檔案" });
    return;
  }

  const buffer = req.file.buffer;
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().map((e) => e.entryName);

  let versionLabel = "imported";
  let mcVersion = "unknown";
  let modloader = "Fabric";
  let modloaderVersion: string | null = null;
  const fileRecords: Array<{
    file_name: string;
    dest_path: string;
    file_url: string;
    file_hash: string;
    file_size_bytes: number;
  }> = [];

  if (entries.includes("manifest.json")) {
    // CurseForge 格式
    const manifest = JSON.parse(zip.readAsText("manifest.json"));
    mcVersion = manifest.minecraft?.version ?? "unknown";
    const loaderInfo = manifest.minecraft?.modLoaders?.[0];
    if (loaderInfo?.id) {
      const parts = loaderInfo.id.split("-");
      modloader = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      modloaderVersion = parts[1] ?? null;
    }
    versionLabel = manifest.name ? `${manifest.name}-${manifest.version ?? "imported"}` : "cf-imported";

    // 批量查 CF API，逐檔下載位元組進全域池（sha256 正規化）；全有或全無
    const fileIds: string[] = (manifest.files ?? []).map((f: any) => String(f.fileID));
    if (fileIds.length > 0) {
      if (!config.curseforgeKey) {
        res.status(400).json({ message: "缺少 CURSEFORGE_KEY，無法解析 CurseForge 檔案" });
        return;
      }
      const cfResult = await modsService.getModFiles(fileIds);
      const cfFiles: any[] = cfResult?.data ?? [];
      const limiter = createImportLimiter();
      const failures: string[] = [];

      // CF API 未回傳的 fileId 視為取不到（不建半殘包）
      const returnedIds = new Set(cfFiles.map((c) => String(c.id)));
      for (const fid of fileIds) {
        if (!returnedIds.has(fid)) failures.push(`fileId ${fid}`);
      }

      const resolved = await Promise.allSettled(
        cfFiles.map((cfFile) =>
          ensureCurseforgeFileInPool(
            { fileId: Number(cfFile.id), fileName: cfFile.fileName, downloadUrl: cfFile.downloadUrl },
            config.curseforgeKey,
            limiter
          ).then((pool) => ({ cfFile, pool }))
        )
      );
      for (const r of resolved) {
        if (r.status === "fulfilled") {
          const { cfFile, pool } = r.value;
          fileRecords.push({
            file_name: cfFile.fileName,
            dest_path: `mods/${cfFile.fileName}`,
            file_url: pool.url,
            file_hash: pool.sha256,
            file_size_bytes: pool.size,
          });
        } else {
          const reason = r.reason;
          failures.push(reason instanceof PoolResolveError ? reason.fileName : "未知檔案");
        }
      }

      if (failures.length > 0) {
        res.status(422).json({ message: "部分 CurseForge 檔案無法取得，未建立版本", failures });
        return;
      }
    }

    // overrides/ 資料夾的檔案上傳到 S3
    for (const entry of zip.getEntries()) {
      if (entry.entryName.startsWith("overrides/") && !entry.isDirectory) {
        const relPath = entry.entryName.replace(/^overrides\//, "");
        const fileBuffer = entry.getData();
        const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        const ext = path.extname(relPath);
        const key = `modpacks/${serverId}/files/${hash}${ext}`;
        const url = await uploadToS3(key, fileBuffer, "application/octet-stream");
        fileRecords.push({
          file_name: path.basename(relPath),
          dest_path: relPath,
          file_url: url,
          file_hash: hash,
          file_size_bytes: fileBuffer.length,
        });
      }
    }
  } else if (entries.includes("modrinth.index.json")) {
    // Modrinth 格式
    const index = JSON.parse(zip.readAsText("modrinth.index.json"));
    mcVersion = index.dependencies?.minecraft ?? "unknown";
    const fabricVersion = index.dependencies?.["fabric-loader"];
    const forgeVersion = index.dependencies?.["forge"];
    const neoforgeVersion = index.dependencies?.["neoforge"];
    if (fabricVersion) { modloader = "Fabric"; modloaderVersion = fabricVersion; }
    else if (neoforgeVersion) { modloader = "NeoForge"; modloaderVersion = neoforgeVersion; }
    else if (forgeVersion) { modloader = "Forge"; modloaderVersion = forgeVersion; }
    versionLabel = index.name ? `${index.name}-${index.versionId ?? "imported"}` : "modrinth-imported";

    // 逐檔進全域池（headObject 命中則免下載；未命中則下載並核對 API sha256）；全有或全無
    const mrFiles: any[] = index.files ?? [];
    if (mrFiles.length > 0) {
      const limiter = createImportLimiter();
      const failures: string[] = [];
      const resolved = await Promise.allSettled(
        mrFiles.map((f) => ensureModrinthFileInPool(f, limiter).then((pool) => ({ f, pool })))
      );
      for (const r of resolved) {
        if (r.status === "fulfilled") {
          const { f, pool } = r.value;
          fileRecords.push({
            file_name: path.basename(f.path),
            dest_path: f.path,
            file_url: pool.url,
            file_hash: pool.sha256,
            file_size_bytes: pool.size,
          });
        } else {
          const reason = r.reason;
          failures.push(reason instanceof PoolResolveError ? reason.fileName : "未知檔案");
        }
      }
      if (failures.length > 0) {
        res.status(422).json({ message: "部分 Modrinth 檔案無法取得，未建立版本", failures });
        return;
      }
    }

    // overrides/ 資料夾
    for (const entry of zip.getEntries()) {
      if (entry.entryName.startsWith("overrides/") && !entry.isDirectory) {
        const relPath = entry.entryName.replace(/^overrides\//, "");
        const fileBuffer = entry.getData();
        const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
        const ext = path.extname(relPath);
        const key = `modpacks/${serverId}/files/${hash}${ext}`;
        const url = await uploadToS3(key, fileBuffer, "application/octet-stream");
        fileRecords.push({
          file_name: path.basename(relPath),
          dest_path: relPath,
          file_url: url,
          file_hash: hash,
          file_size_bytes: fileBuffer.length,
        });
      }
    }
  } else {
    // 純自訂 zip，當作單一資源包加入
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const fileName = req.file.originalname;
    const key = `modpacks/${serverId}/files/${hash}.zip`;
    const url = await uploadToS3(key, buffer, "application/zip");
    fileRecords.push({
      file_name: fileName,
      dest_path: `resourcepacks/${fileName}`,
      file_url: url,
      file_hash: hash,
      file_size_bytes: buffer.length,
    });
    versionLabel = `custom-${Date.now()}`;
  }

  const versionId = crypto.randomUUID();
  const filesWithIds = fileRecords.map((f) => ({
    id: crypto.randomUUID(),
    version_id: versionId,
    ...f,
  }));

  await Mysql.getPool().query(
    `INSERT INTO server_modpack_versions
       (id, server_id, sub_server_id, version_label, mc_version, modloader, modloader_version, draft_files, file_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, serverId, sub_server_id ?? null, versionLabel, mcVersion, modloader, modloaderVersion,
      JSON.stringify(filesWithIds), filesWithIds.length]
  );

  const [rows]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ?",
    [versionId]
  );
  const { draft_files: _df, ...row } = rows[0];
  res.status(201).json({ ...row, is_active: false, file_count: filesWithIds.length });
}

/** 更新版本 metadata */
export async function updateVersion(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;
  const { version_label, mc_version, modloader, modloader_version, notes } = req.body;

  const [rows]: any = await Mysql.getPool().query(
    "SELECT id FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!rows.length) { res.status(404).json({ message: "找不到該版本" }); return; }

  await Mysql.getPool().query(
    `UPDATE server_modpack_versions
     SET version_label = COALESCE(?, version_label),
         mc_version    = COALESCE(?, mc_version),
         modloader     = COALESCE(?, modloader),
         modloader_version = ?,
         notes         = ?
     WHERE id = ?`,
    [version_label ?? null, mc_version ?? null, modloader ?? null, modloader_version ?? null, notes ?? null, versionId]
  );

  const [updated]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ?",
    [versionId]
  );
  const { draft_files: _df, ...row } = updated[0];
  res.json({ ...row, is_active: row.is_active === 1, file_count: Number(row.file_count) });
}

/** 刪除版本（active 版本不可刪） */
export async function deleteVersion(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;

  const [rows]: any = await Mysql.getPool().query(
    "SELECT id, is_active FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!rows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  if (rows[0].is_active) {
    res.status(400).json({ message: "目前使用中的版本無法刪除，請先切換到其他版本" });
    return;
  }

  await Mysql.getPool().query("DELETE FROM server_modpack_versions WHERE id = ?", [versionId]);
  res.status(204).send();
}

/** 設為目前版本（先清空同一子伺服器的 is_active，再設此版本；is_active 以子伺服器為單位） */
export async function activateVersion(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;

  const [rows]: any = await Mysql.getPool().query(
    "SELECT id, status, sub_server_id FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!rows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  if (rows[0].status !== "published") {
    res.status(400).json({ message: "只能將已發布的版本設為目前版本" });
    return;
  }

  const pool = Mysql.getPool();
  // <=> 為 NULL 安全等於：sub_server_id 為 NULL 的版本自成一組，不會與已指定子伺服器的版本互相清除
  await pool.query(
    "UPDATE server_modpack_versions SET is_active = 0 WHERE server_id = ? AND sub_server_id <=> ?",
    [serverId, rows[0].sub_server_id]
  );
  await pool.query("UPDATE server_modpack_versions SET is_active = 1 WHERE id = ?", [versionId]);
  res.json({ ok: true });
}

/** 取得某子伺服器目前啟用中的 modpack 版本（供啟動流程取 manifest）；無啟用版本時回 404 */
export async function getActiveModpackForSubServer(req: Request, res: Response): Promise<void> {
  const { serverId, subServerId } = req.params;

  const [rows]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE server_id = ? AND sub_server_id = ? AND is_active = 1 LIMIT 1",
    [serverId, subServerId]
  );
  if (!rows.length) {
    res.status(404).json({ message: "該子伺服器尚無啟用中的模組包版本" });
    return;
  }

  const { draft_files: _df, ...row } = rows[0];
  res.json({ ...row, is_active: true, file_count: Number(row.file_count) });
}

/** 發布版本：產生 manifest.json 並上傳 S3，更新 status 與 manifest_url，清空 draft_files */
export async function publishVersion(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  const version = vRows[0];

  // §12.7：已發布版本不可重 publish（避免以空 draft_files 覆寫既有 manifest）。
  if (version.status === "published") {
    res.status(409).json({ code: "Conflict", message: "此版本已發布，無法重複發布" });
    return;
  }

  const files: any[] = JSON.parse(version.draft_files || "[]");

  const manifest = {
    version_id: versionId,
    mc_version: version.mc_version,
    modloader: version.modloader,
    modloader_version: version.modloader_version,
    // 只有啟用中（disabled !== true）的條目寫進 manifest；停用項不發給玩家。
    files: files
      .filter((f) => f.disabled !== true)
      .map((f) => ({
        path: f.dest_path,
        url: f.file_url,
        hash: f.file_hash,
        size: Number(f.file_size_bytes),
        // 僅非缺省（default）才寫出，保持 manifest 精簡；enforced 為缺省，省略。
        ...(f.policy && f.policy !== "enforced" ? { policy: f.policy } : {}),
      })),
  };

  const manifestBuffer = Buffer.from(JSON.stringify(manifest, null, 2), "utf-8");
  const key = `modpacks/${serverId}/${versionId}/manifest.json`;
  const manifestUrl = await uploadToS3(key, manifestBuffer, "application/json");

  // 引用計數：只對 url 指向全域池（mods/files/）的條目記引用；overrides/自訂 zip 跳過。
  // 以全量 draft_files 計（含停用項）——停用檔位元組須不被 recycle_orphan_mods 回收，否則再啟用 404。
  // 只有 published 算引用，故在此維護；重新 publish 先清舊列再插新列（同 transaction）。
  const poolSha256s = Array.from(
    new Set(
      files
        .filter((f) => typeof f.file_url === "string" && f.file_url.includes("/mods/files/"))
        .map((f) => f.file_hash as string)
    )
  );

  const conn = await Mysql.getPool().getConnection();
  try {
    await conn.beginTransaction();
    // draft_files 不清空：published 版即保有含停用項的全量 authoring record（供 derive/getFiles/restore）。
    await conn.query(
      "UPDATE server_modpack_versions SET status = 'published', manifest_url = ? WHERE id = ?",
      [manifestUrl, versionId]
    );
    await conn.query("DELETE FROM modpack_file_refs WHERE version_id = ?", [versionId]);
    for (const sha256 of poolSha256s) {
      await conn.query(
        "INSERT IGNORE INTO modpack_file_refs (sha256, version_id) VALUES (?, ?)",
        [sha256, versionId]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const [updated]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ?",
    [versionId]
  );
  const { draft_files: _df, ...row } = updated[0];
  res.json({ ...row, is_active: row.is_active === 1, file_count: files.length });
}

/**
 * 從已發布版本 copy-on-write 衍生新草稿：複製 metadata 與基底 manifest 的檔案清單，
 * base_version_id 指回基底。前置：:versionId 必須是 published 版本。
 */
export async function deriveVersion(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;
  const { label } = req.body;

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  const base = vRows[0];
  if (base.status !== "published") {
    res.status(409).json({ code: "Conflict", message: "只能從已發布的版本衍生草稿" });
    return;
  }

  // 基底檔案優先來自基底 draft_files（全量含停用項，disabled 原樣帶回）；
  // 舊版本（本任務落地前發布）draft_files 為空 → fallback 從 manifest 全量複製（一律 enabled）。
  const draftId = crypto.randomUUID();
  let draftFiles: any[] = [];
  const baseDraft: any[] = JSON.parse(base.draft_files || "[]");
  if (baseDraft.length) {
    draftFiles = baseDraft.map((f) => ({
      id: crypto.randomUUID(),
      version_id: draftId,
      file_name: f.file_name,
      dest_path: f.dest_path,
      file_url: f.file_url,
      file_hash: f.file_hash,
      file_size_bytes: f.file_size_bytes,
      policy: f.policy ?? "enforced",
      // 停用狀態原樣帶回新草稿。
      disabled: f.disabled === true,
    }));
  } else if (base.manifest_url) {
    const resp = await fetch(base.manifest_url);
    const manifest: any = await resp.json();
    draftFiles = (manifest.files as any[]).map((f) => ({
      id: crypto.randomUUID(),
      version_id: draftId,
      file_name: (f.path as string).split("/").pop(),
      dest_path: f.path,
      file_url: f.url,
      file_hash: f.hash,
      file_size_bytes: f.size,
      // manifest 精簡時省略 enforced；衍生時一律落地為明確值，與 getFiles 缺省補值一致。
      policy: f.policy ?? "enforced",
      disabled: false,
    }));
  }

  const draftLabel = label?.trim() || `${base.version_label}-draft`;

  await Mysql.getPool().query(
    `INSERT INTO server_modpack_versions
       (id, server_id, sub_server_id, version_label, mc_version, modloader, modloader_version,
        notes, status, base_version_id, draft_files, file_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    [draftId, serverId, base.sub_server_id ?? null, draftLabel, base.mc_version, base.modloader,
      base.modloader_version ?? null, base.notes ?? null, versionId,
      JSON.stringify(draftFiles), draftFiles.length]
  );

  const [rows]: any = await Mysql.getPool().query(
    "SELECT * FROM server_modpack_versions WHERE id = ?",
    [draftId]
  );
  const { draft_files: _df, ...row } = rows[0];
  res.status(201).json({ ...row, is_active: false, file_count: draftFiles.length });
}

/** 取得版本的所有檔案列表（draft 從 draft_files JSON 欄位，published 從 S3 manifest） */
export async function getFiles(req: Request, res: Response): Promise<void> {
  const { versionId } = req.params;

  const [vers]: any = await Mysql.getPool().query(
    "SELECT status, manifest_url, draft_files FROM server_modpack_versions WHERE id = ?",
    [versionId]
  );
  if (!vers.length) { res.status(404).json({ message: "找不到該版本" }); return; }

  const { status, manifest_url, draft_files } = vers[0];

  const stored: any[] = JSON.parse(draft_files || "[]");
  // published 舊版本（本任務落地前發布）draft_files 為空 → fallback manifest（全量視為 enabled）。
  if (status === "published" && stored.length === 0 && manifest_url) {
    const resp = await fetch(manifest_url);
    const manifest: any = await resp.json();
    const files = (manifest.files as any[]).map((f) => ({
      id: f.hash,
      version_id: versionId,
      file_name: (f.path as string).split("/").pop(),
      dest_path: f.path,
      file_url: f.url,
      file_hash: f.hash,
      file_size_bytes: f.size,
      // manifest 精簡時省略 enforced；回傳一律補上明確值。
      policy: f.policy ?? "enforced",
      disabled: false,
    }));
    res.json(files);
    return;
  }

  // draft 與 published（含 draft_files）同一路徑：全量含停用項。
  stored.sort((a, b) => (a.dest_path as string).localeCompare(b.dest_path));
  // 舊資料可能無 policy/disabled 欄位；回傳一律補上明確值。
  res.json(stored.map((f) => ({ ...f, policy: f.policy ?? "enforced", disabled: f.disabled === true })));
}

/** 上傳單一檔案到版本（multer memory + SHA-256 + S3），只允許 draft 版本 */
export async function addFile(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;
  const { dest_path, policy, disabled } = req.body;

  if (!req.file) { res.status(400).json({ message: "請上傳檔案" }); return; }
  if (!dest_path?.trim()) { res.status(400).json({ message: "dest_path 為必填" }); return; }
  // policy 選填；有帶則須為 enforced | default（不帶 = 缺省 enforced，靜默降級難查故拒絕非法值）。
  if (policy !== undefined && policy !== "enforced" && policy !== "default") {
    res.status(400).json({ message: "policy 僅接受 enforced | default" });
    return;
  }
  // disabled 選填；有帶則須為 boolean（比照 policy 非法值拒絕）。
  if (disabled !== undefined && typeof disabled !== "boolean") {
    res.status(400).json({ message: "disabled 僅接受 boolean" });
    return;
  }

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT status, draft_files FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  if (vRows[0].status !== "draft") {
    res.status(400).json({ message: "只能對 draft 版本新增檔案" });
    return;
  }

  const buffer = req.file.buffer;
  const pool = await ensureBufferInPool(
    buffer,
    req.file.originalname,
    req.file.mimetype || "application/octet-stream"
  );
  // 位元組已在記憶體 → 順路解 metadata 落庫（best-effort，不影響上傳主流程）。
  await captureModMetadata(pool.sha256, buffer, path.extname(req.file.originalname));

  const destPath = dest_path.trim();
  const files: any[] = JSON.parse(vRows[0].draft_files || "[]");
  // §12.8：同 dest_path 已存在則替換該 entry（沿用原 id 保持前端引用穩定），file_count 不變；
  // 不存在則追加、file_count + 1。
  const idx = files.findIndex((f) => f.dest_path === destPath);
  const existing = idx !== -1 ? files[idx] : null;

  // 替換且請求未明帶時，沿用原 entry 的 policy / disabled（不缺省重置）。
  const resolvedPolicy = policy ?? existing?.policy;
  const resolvedDisabled = disabled ?? existing?.disabled;
  const newFile = {
    id: existing ? existing.id : crypto.randomUUID(),
    version_id: versionId,
    file_name: req.file.originalname,
    dest_path: destPath,
    file_url: pool.url,
    file_hash: pool.sha256,
    file_size_bytes: pool.size,
    // 有合法 policy（明帶或沿用）才持久化；否則不寫欄位，維持缺省（enforced）語意。
    ...(resolvedPolicy ? { policy: resolvedPolicy } : {}),
    // disabled 僅 true 才寫欄位；缺省 false 省略，讀取端補值。
    ...(resolvedDisabled ? { disabled: true } : {}),
  };

  if (existing) {
    files[idx] = newFile;
    await Mysql.getPool().query(
      "UPDATE server_modpack_versions SET draft_files = ? WHERE id = ?",
      [JSON.stringify(files), versionId]
    );
  } else {
    files.push(newFile);
    await Mysql.getPool().query(
      "UPDATE server_modpack_versions SET draft_files = ?, file_count = file_count + 1 WHERE id = ?",
      [JSON.stringify(files), versionId]
    );
  }

  res.status(201).json(newFile);
}

/**
 * 從平台（CF / Modrinth）下載單一版本檔案並加入 draft 版本（F13a-3）。
 *
 * 複用進池管線（cf_file_hashes 快取 / headObject 免下載 / 全域併發 16 / 順路 metadata），
 * 寫入語意比照 addFile §12.8（同 dest_path 替換、沿用原 id / policy / disabled）。
 * 僅允許 draft（published → 409）；上游取檔或下載失敗 → 502 且不動 draft_files。
 */
export async function addFileFromPlatform(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;
  const { source, projectId, versionId: platformVersionId } = req.body;

  if (source !== "curseforge" && source !== "modrinth") {
    res.status(400).json({ message: "source 僅接受 curseforge | modrinth" });
    return;
  }
  if (!projectId || !platformVersionId) {
    res.status(400).json({ message: "projectId 與 versionId 為必填" });
    return;
  }

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT status, draft_files FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  // published guard：比照 restoreFile/updateFilePolicy 用 409（addFile 用 400，屬既有慣例差異）。
  if (vRows[0].status !== "draft") {
    res.status(409).json({ code: "Conflict", message: "只能對 draft 版本新增檔案" });
    return;
  }

  if (source === "curseforge" && !config.curseforgeKey) {
    res.status(503).json({ code: "ServiceUnavailable", message: "CurseForge 服務未設定" });
    return;
  }

  // 取平台檔案資訊 → 進池（上游/下載失敗一律 502，不寫 draft_files，不建半殘 entry）。
  let pool: { sha256: string; url: string; size: number };
  let fileName: string;
  const limiter = createImportLimiter();
  try {
    if (source === "curseforge") {
      const info = await platformCurseforgeService.getVersionFile(
        String(projectId),
        String(platformVersionId)
      );
      fileName = info.fileName;
      // downloadUrl 為 null 原樣傳入 → pool 走 forgecdn 慣例重建（非直接 502）。
      pool = await ensureCurseforgeFileInPool(
        { fileId: info.fileId!, fileName: info.fileName, downloadUrl: info.downloadUrl },
        config.curseforgeKey,
        limiter
      );
    } else {
      const info = await platformModrinthService.getVersionFile(String(platformVersionId));
      fileName = info.fileName;
      pool = await ensureModrinthFileInPool(
        {
          path: info.fileName,
          hashes: { sha256: info.sha256 },
          downloads: [info.url],
          fileSize: info.size,
        },
        limiter
      );
    }
  } catch (err) {
    const message = err instanceof PoolResolveError ? err.message : (err as Error).message;
    res.status(502).json({ code: "BadGateway", message: `平台檔案取得失敗：${message}` });
    return;
  }

  // §12.8：同 dest_path 已存在則替換（沿用原 id 保引用穩定），否則追加、file_count + 1。
  const destPath = `mods/${fileName}`;
  const files: any[] = JSON.parse(vRows[0].draft_files || "[]");
  const idx = files.findIndex((f) => f.dest_path === destPath);
  const existing = idx !== -1 ? files[idx] : null;

  // body 不帶 policy/disabled → 沿用原 entry（無原 entry 則缺省 enforced / 未停用）。
  const resolvedPolicy = existing?.policy;
  const resolvedDisabled = existing?.disabled;
  const newFile: any = {
    id: existing ? existing.id : crypto.randomUUID(),
    version_id: versionId,
    file_name: fileName,
    dest_path: destPath,
    file_url: pool.url,
    file_hash: pool.sha256,
    file_size_bytes: pool.size,
    ...(resolvedPolicy ? { policy: resolvedPolicy } : {}),
    ...(resolvedDisabled ? { disabled: true } : {}),
  };

  if (existing) {
    files[idx] = newFile;
    await Mysql.getPool().query(
      "UPDATE server_modpack_versions SET draft_files = ? WHERE id = ?",
      [JSON.stringify(files), versionId]
    );
  } else {
    files.push(newFile);
    await Mysql.getPool().query(
      "UPDATE server_modpack_versions SET draft_files = ?, file_count = file_count + 1 WHERE id = ?",
      [JSON.stringify(files), versionId]
    );
  }

  // 回傳補上明確 policy / disabled（規格 §3.4-5）。
  res.status(201).json({
    ...newFile,
    policy: newFile.policy ?? "enforced",
    disabled: newFile.disabled === true,
  });
}

/** 從版本移除檔案（不刪除 S3 上的物件，只允許 draft 版本） */
export async function removeFile(req: Request, res: Response): Promise<void> {
  const { versionId, fileId } = req.params;

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT status, draft_files FROM server_modpack_versions WHERE id = ?",
    [versionId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }

  const files: any[] = JSON.parse(vRows[0].draft_files || "[]");
  const idx = files.findIndex((f) => f.id === fileId);
  if (idx === -1) { res.status(404).json({ message: "找不到該檔案" }); return; }

  files.splice(idx, 1);
  await Mysql.getPool().query(
    "UPDATE server_modpack_versions SET draft_files = ?, file_count = GREATEST(0, file_count - 1) WHERE id = ?",
    [JSON.stringify(files), versionId]
  );
  res.status(204).send();
}

/**
 * 從基底版本（base_version_id）的 manifest 還原單一檔案 entry 回草稿。
 * 同端點涵蓋「還原修改」（同 path 替換）與「還原刪除」（加回消失的 entry）。
 */
export async function restoreFile(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;
  const { destPath } = req.body;

  if (!destPath?.trim()) { res.status(400).json({ message: "destPath 為必填" }); return; }
  const target = destPath.trim();

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT status, base_version_id, draft_files FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  if (vRows[0].status !== "draft") {
    res.status(409).json({ code: "Conflict", message: "只能對 draft 版本還原檔案" });
    return;
  }
  if (!vRows[0].base_version_id) {
    res.status(422).json({ message: "此草稿無基底版本，無法還原" });
    return;
  }

  // 還原來源優先取基底 draft_files（全量含停用項）；空/NULL → fallback 基底 manifest（舊版本，全 enabled）。
  const [bRows]: any = await Mysql.getPool().query(
    "SELECT manifest_url, draft_files FROM server_modpack_versions WHERE id = ?",
    [vRows[0].base_version_id]
  );
  if (!bRows.length) { res.status(404).json({ message: "基底版本無此檔案" }); return; }

  // 正規化成 manifest-key 形狀（path/url/hash/size/policy/disabled）供後續組裝沿用。
  let baseEntry: any = null;
  const baseDraft: any[] = JSON.parse(bRows[0].draft_files || "[]");
  if (baseDraft.length) {
    const e = baseDraft.find((f) => f.dest_path === target);
    if (e) {
      baseEntry = {
        path: e.dest_path, url: e.file_url, hash: e.file_hash,
        size: e.file_size_bytes, policy: e.policy, disabled: e.disabled === true,
      };
    }
  } else if (bRows[0].manifest_url) {
    const resp = await fetch(bRows[0].manifest_url);
    const manifest: any = await resp.json();
    const e = (manifest.files as any[]).find((f) => f.path === target);
    if (e) baseEntry = { ...e, disabled: false };
  }
  if (!baseEntry) { res.status(404).json({ message: "基底版本無此檔案" }); return; }

  const files: any[] = JSON.parse(vRows[0].draft_files || "[]");
  const idx = files.findIndex((f) => f.dest_path === target);
  const restored = {
    // 還原修改：沿用原 draft entry 的 id 保持前端引用穩定；還原刪除：新 id。
    id: idx !== -1 ? files[idx].id : crypto.randomUUID(),
    version_id: versionId,
    file_name: (baseEntry.path as string).split("/").pop(),
    dest_path: baseEntry.path,
    file_url: baseEntry.url,
    file_hash: baseEntry.hash,
    file_size_bytes: baseEntry.size,
    policy: baseEntry.policy ?? "enforced",
    // 連同基底 disabled 狀態抄回。
    disabled: baseEntry.disabled === true,
  };

  if (idx !== -1) {
    // 還原修改：替換原 entry，file_count 不變。
    files[idx] = restored;
    await Mysql.getPool().query(
      "UPDATE server_modpack_versions SET draft_files = ? WHERE id = ?",
      [JSON.stringify(files), versionId]
    );
  } else {
    // 還原刪除：加回 entry，file_count + 1。
    files.push(restored);
    await Mysql.getPool().query(
      "UPDATE server_modpack_versions SET draft_files = ?, file_count = file_count + 1 WHERE id = ?",
      [JSON.stringify(files), versionId]
    );
  }

  files.sort((a, b) => (a.dest_path as string).localeCompare(b.dest_path));
  res.json(files.map((f) => ({ ...f, policy: f.policy ?? "enforced", disabled: f.disabled === true })));
}

/**
 * 更新草稿內單一檔案的 policy（enforced ⇄ default）與/或 disabled（停用旗標）；
 * 只允許 draft，published 版 409。body 可帶 policy、disabled 其一或皆有，至少一項。
 */
export async function updateFilePolicy(req: Request, res: Response): Promise<void> {
  const { serverId, versionId, fileId } = req.params;
  const { policy, disabled } = req.body;

  // 至少需帶一項可更新欄位；各欄有帶才校驗（不帶 = 不動）。
  if (policy === undefined && disabled === undefined) {
    res.status(400).json({ message: "至少需帶 policy 或 disabled 其一" });
    return;
  }
  if (policy !== undefined && policy !== "enforced" && policy !== "default") {
    res.status(400).json({ message: "policy 僅接受 enforced | default" });
    return;
  }
  if (disabled !== undefined && typeof disabled !== "boolean") {
    res.status(400).json({ message: "disabled 僅接受 boolean" });
    return;
  }

  const [vRows]: any = await Mysql.getPool().query(
    "SELECT status, draft_files FROM server_modpack_versions WHERE id = ? AND server_id = ?",
    [versionId, serverId]
  );
  if (!vRows.length) { res.status(404).json({ message: "找不到該版本" }); return; }
  if (vRows[0].status !== "draft") {
    res.status(409).json({ code: "Conflict", message: "只能對 draft 版本調整 policy" });
    return;
  }

  const files: any[] = JSON.parse(vRows[0].draft_files || "[]");
  const idx = files.findIndex((f) => f.id === fileId);
  if (idx === -1) { res.status(404).json({ message: "找不到該檔案" }); return; }

  if (policy !== undefined) files[idx].policy = policy;
  // disabled 缺省 false 採「省略欄位」齊一風格（與 addFile 一致）：false 則移除欄位。
  if (disabled !== undefined) {
    if (disabled) files[idx].disabled = true;
    else delete files[idx].disabled;
  }
  await Mysql.getPool().query(
    "UPDATE server_modpack_versions SET draft_files = ? WHERE id = ?",
    [JSON.stringify(files), versionId]
  );

  files.sort((a, b) => (a.dest_path as string).localeCompare(b.dest_path));
  res.json(files.map((f) => ({ ...f, policy: f.policy ?? "enforced", disabled: f.disabled === true })));
}
