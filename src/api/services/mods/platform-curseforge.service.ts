/**
 * @file platform-curseforge.service.ts
 * @description CurseForge 瀏覽 proxy 客戶端（F13a-3）：搜尋 / 版本清單 / 批次專案 / 取單版本檔案，
 *   各方法把 CF API 回應收斂成 platform.types 的正規化形狀。CF key 一律以 x-api-key 注入。
 * @notes 只做唯讀瀏覽與「取檔案資訊」；實際下載進池由 utils/modpool/pool 處理，不在此。
 * @dependencies got, config.service（CurseForge API Key）
 */
import got from "got";
import { config } from "../../../config/config.service";
import {
  LoaderName,
  PlatformProject,
  PlatformSearchItem,
  PlatformVersion,
  PlatformVersionFile,
} from "./platform.types";

const CF_BASE = "https://api.curseforge.com/v1";
/** Minecraft 的 CF gameId */
const GAME_ID = 432;
/** Mods 的 CF classId */
const MOD_CLASS_ID = 6;

/** loader → CF modLoaderType 列舉 */
const CF_LOADER_TYPE: Record<LoaderName, number> = {
  Forge: 1,
  Fabric: 4,
  Quilt: 5,
  NeoForge: 6,
};

/** 已知 loader 名（小寫），用於從 CF gameVersions 混合陣列中辨識 loader */
const KNOWN_LOADERS = new Set(["forge", "fabric", "quilt", "neoforge"]);

/** CF 依賴 relationType → 正規化型別（3=Required、2=Optional，其餘丟棄） */
function mapCfRelation(relationType: number): "required" | "optional" | null {
  if (relationType === 3) return "required";
  if (relationType === 2) return "optional";
  return null;
}

/** CF 請求共用 header（含 x-api-key） */
function cfHeaders(): Record<string, string> {
  return { Accept: "application/json", "x-api-key": config.curseforgeKey };
}

/**
 * 從 CF file 的 gameVersions 混合陣列拆出 MC 版本與 loader 名。
 * CF 把 loader 名與遊戲版本混在同一陣列，以「開頭是否為數字」粗略區分版本。
 */
function splitCfGameVersions(gameVersions: string[]): {
  mcVersions: string[];
  loaders: string[];
} {
  const mcVersions: string[] = [];
  const loaders: string[] = [];
  for (const v of gameVersions ?? []) {
    if (KNOWN_LOADERS.has(String(v).toLowerCase())) loaders.push(v);
    else if (/^\d/.test(String(v))) mcVersions.push(v);
  }
  return { mcVersions, loaders };
}

/** 把單筆 CF file 正規化為 PlatformVersion */
function normalizeCfFile(file: any): PlatformVersion {
  const { mcVersions, loaders } = splitCfGameVersions(file.gameVersions);
  const dependencies = (file.dependencies ?? [])
    .map((d: any) => {
      const type = mapCfRelation(d.relationType);
      return type && d.modId != null ? { projectId: String(d.modId), type } : null;
    })
    .filter(Boolean);
  return {
    versionId: String(file.id),
    name: file.displayName ?? file.fileName ?? "",
    fileName: file.fileName ?? "",
    size: Number(file.fileLength ?? 0),
    date: file.fileDate ?? "",
    mcVersions,
    loaders,
    dependencies,
  };
}

export default class PlatformCurseforgeService {
  /**
   * 搜尋 CF 模組（gameId=432、classId=6）。
   * @param q 搜尋字串
   * @param opts mcVersion / loader / limit
   */
  public async search(
    q: string,
    opts: { mcVersion?: string; loader?: LoaderName; limit: number }
  ): Promise<PlatformSearchItem[]> {
    const searchParams: Record<string, string | number> = {
      gameId: GAME_ID,
      classId: MOD_CLASS_ID,
      searchFilter: q,
      pageSize: opts.limit,
    };
    if (opts.mcVersion) searchParams.gameVersion = opts.mcVersion;
    if (opts.loader) searchParams.modLoaderType = CF_LOADER_TYPE[opts.loader];

    const res = await got.get<any>(`${CF_BASE}/mods/search`, {
      headers: cfHeaders(),
      searchParams,
      responseType: "json",
    });
    return (res.body?.data ?? []).map(
      (m: any): PlatformSearchItem => ({
        source: "curseforge",
        projectId: String(m.id),
        slug: m.slug ?? "",
        name: m.name ?? "",
        author: m.authors?.[0]?.name ?? "",
        description: m.summary ?? "",
        iconUrl: m.logo?.url ?? null,
        downloads: Number(m.downloadCount ?? 0),
      })
    );
  }

  /**
   * 取某 CF 專案的版本（檔案）清單，含依賴。
   * @param projectId CF modId
   * @param opts mcVersion / loader 透傳過濾、limit
   */
  public async listVersions(
    projectId: string,
    opts: { mcVersion?: string; loader?: LoaderName; limit: number }
  ): Promise<PlatformVersion[]> {
    const searchParams: Record<string, string | number> = { pageSize: opts.limit };
    if (opts.mcVersion) searchParams.gameVersion = opts.mcVersion;
    if (opts.loader) searchParams.modLoaderType = CF_LOADER_TYPE[opts.loader];

    const res = await got.get<any>(`${CF_BASE}/mods/${projectId}/files`, {
      headers: cfHeaders(),
      searchParams,
      responseType: "json",
    });
    return (res.body?.data ?? []).map(normalizeCfFile);
  }

  /**
   * 批次取 CF 專案資訊（供依賴顯示名稱 / 圖示）；查不到的 id 由上游自動略過。
   * @param projectIds CF modId 陣列
   */
  public async getProjects(projectIds: string[]): Promise<PlatformProject[]> {
    const res = await got.post<any>(`${CF_BASE}/mods`, {
      headers: { ...cfHeaders(), "Content-Type": "application/json" },
      json: { modIds: projectIds.map((id) => Number(id)) },
      responseType: "json",
    });
    return (res.body?.data ?? []).map(
      (m: any): PlatformProject => ({
        projectId: String(m.id),
        name: m.name ?? "",
        slug: m.slug ?? "",
        iconUrl: m.logo?.url ?? null,
      })
    );
  }

  /**
   * 取單一 CF 版本（fileId）的檔案資訊，供 from-platform 進池。
   * downloadUrl 可能為 null → 原樣回傳，交由 pool 以 forgecdn 慣例重建。
   * @param projectId CF modId
   * @param fileId CF fileId（即 versionId）
   */
  public async getVersionFile(
    projectId: string,
    fileId: string
  ): Promise<PlatformVersionFile> {
    const res = await got.get<any>(`${CF_BASE}/mods/${projectId}/files/${fileId}`, {
      headers: cfHeaders(),
      responseType: "json",
    });
    const file = res.body?.data;
    if (!file) throw new Error("CurseForge 版本檔案不存在");
    return {
      fileId: Number(file.id),
      fileName: file.fileName ?? "",
      downloadUrl: file.downloadUrl ?? null,
    };
  }
}