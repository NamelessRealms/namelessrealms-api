/**
 * @file server-modpack.controller.ts
 * @description 伺服器模組包版本管理：建立/匯入版本、管理檔案、發布 manifest、設定 active 版本
 *
 * 檔案儲存架構：
 *   - Draft 版本：檔案清單存在 server_modpack_versions.draft_files（JSON TEXT）
 *   - Published 版本：draft_files 清空，檔案從 manifest_url（S3 JSON）讀取
 *   - server_modpack_files 表已廢棄，不再使用
 *
 * @methods
 *   - getVersions: 取得版本列表（含 file_count）；可用 ?subServerId 篩選
 *   - createVersion: 從零建立新版本（只傳 metadata，可選綁定 sub_server_id）
 *   - importVersion: 匯入 CurseForge/Modrinth 模組包並解析檔案（可選綁定 sub_server_id）
 *   - updateVersion: 更新版本 metadata
 *   - deleteVersion: 刪除版本（active 版本不可刪）
 *   - activateVersion: 設為目前版本（is_active 以子伺服器為單位）
 *   - getActiveModpackForSubServer: 取某子伺服器啟用中的版本（供啟動流程取 manifest）
 *   - publishVersion: 產生 manifest.json 上傳 S3 並清空 draft_files
 *   - getFiles: 取得版本的檔案列表（draft 從 JSON 欄位，published 從 S3 manifest）
 *   - addFile: 上傳單一檔案到版本（只允許 draft）
 *   - removeFile: 從版本移除檔案（只允許 draft，不刪 S3）
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

const modsService = new ModsService();

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

  const files: any[] = JSON.parse(version.draft_files || "[]");

  const manifest = {
    version_id: versionId,
    mc_version: version.mc_version,
    modloader: version.modloader,
    modloader_version: version.modloader_version,
    files: files.map((f) => ({
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
    await conn.query(
      "UPDATE server_modpack_versions SET status = 'published', manifest_url = ?, draft_files = '[]' WHERE id = ?",
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

/** 取得版本的所有檔案列表（draft 從 draft_files JSON 欄位，published 從 S3 manifest） */
export async function getFiles(req: Request, res: Response): Promise<void> {
  const { versionId } = req.params;

  const [vers]: any = await Mysql.getPool().query(
    "SELECT status, manifest_url, draft_files FROM server_modpack_versions WHERE id = ?",
    [versionId]
  );
  if (!vers.length) { res.status(404).json({ message: "找不到該版本" }); return; }

  const { status, manifest_url, draft_files } = vers[0];

  if (status === "published" && manifest_url) {
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
    }));
    res.json(files);
    return;
  }

  const files: any[] = JSON.parse(draft_files || "[]");
  files.sort((a, b) => (a.dest_path as string).localeCompare(b.dest_path));
  // draft 舊資料可能無 policy 欄位；回傳一律補上明確值。
  res.json(files.map((f) => ({ ...f, policy: f.policy ?? "enforced" })));
}

/** 上傳單一檔案到版本（multer memory + SHA-256 + S3），只允許 draft 版本 */
export async function addFile(req: Request, res: Response): Promise<void> {
  const { serverId, versionId } = req.params;
  const { dest_path, policy } = req.body;

  if (!req.file) { res.status(400).json({ message: "請上傳檔案" }); return; }
  if (!dest_path?.trim()) { res.status(400).json({ message: "dest_path 為必填" }); return; }
  // policy 選填；有帶則須為 enforced | default（不帶 = 缺省 enforced，靜默降級難查故拒絕非法值）。
  if (policy !== undefined && policy !== "enforced" && policy !== "default") {
    res.status(400).json({ message: "policy 僅接受 enforced | default" });
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

  const fileId = crypto.randomUUID();
  const newFile = {
    id: fileId,
    version_id: versionId,
    file_name: req.file.originalname,
    dest_path: dest_path.trim(),
    file_url: pool.url,
    file_hash: pool.sha256,
    file_size_bytes: pool.size,
    // 請求有帶合法 policy 才持久化；未帶則不寫欄位，維持缺省（enforced）語意。
    ...(policy ? { policy } : {}),
  };

  const files: any[] = JSON.parse(vRows[0].draft_files || "[]");
  files.push(newFile);
  await Mysql.getPool().query(
    "UPDATE server_modpack_versions SET draft_files = ?, file_count = file_count + 1 WHERE id = ?",
    [JSON.stringify(files), versionId]
  );

  res.status(201).json(newFile);
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
