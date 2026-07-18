/**
 * @file platform-modrinth.service.ts
 * @description Modrinth 瀏覽 proxy 客戶端（F13a-3）：搜尋 / 版本清單 / 批次專案 / 取單版本檔案，
 *   各方法把 Modrinth API 回應收斂成 platform.types 的正規化形狀。Modrinth 免 API key。
 * @notes 只做唯讀瀏覽與「取檔案資訊」；實際下載進池由 utils/modpool/pool 處理，不在此。
 * @dependencies got
 */
import got from "got";
import {
  LoaderName,
  PlatformProject,
  PlatformSearchItem,
  PlatformVersion,
  PlatformVersionFile,
} from "./platform.types";

const MR_BASE = "https://api.modrinth.com/v2";

/** loader → Modrinth facet 值（小寫） */
const MR_LOADER: Record<LoaderName, string> = {
  Forge: "forge",
  Fabric: "fabric",
  NeoForge: "neoforge",
  Quilt: "quilt",
};

/** Modrinth dependency_type → 正規化型別（required / optional 保留，其餘丟棄） */
function mapMrDep(dependencyType: string): "required" | "optional" | null {
  if (dependencyType === "required") return "required";
  if (dependencyType === "optional") return "optional";
  return null;
}

/** 取版本的主檔案（primary，缺則第一個） */
function primaryFile(version: any): any | null {
  const files: any[] = version.files ?? [];
  if (!files.length) return null;
  return files.find((f) => f.primary) ?? files[0];
}

/** 把單筆 Modrinth version 正規化為 PlatformVersion */
function normalizeMrVersion(v: any): PlatformVersion {
  const file = primaryFile(v);
  const dependencies = (v.dependencies ?? [])
    .map((d: any) => {
      const type = mapMrDep(d.dependency_type);
      return type && d.project_id ? { projectId: String(d.project_id), type } : null;
    })
    .filter(Boolean);
  return {
    versionId: String(v.id),
    name: v.name ?? v.version_number ?? "",
    fileName: file?.filename ?? "",
    size: Number(file?.size ?? 0),
    date: v.date_published ?? "",
    mcVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    dependencies,
  };
}

export default class PlatformModrinthService {
  /**
   * 搜尋 Modrinth 模組（project_type:mod）。
   * @param q 搜尋字串
   * @param opts mcVersion / loader / limit
   */
  public async search(
    q: string,
    opts: { mcVersion?: string; loader?: LoaderName; limit: number }
  ): Promise<PlatformSearchItem[]> {
    const facets: string[][] = [["project_type:mod"]];
    if (opts.loader) facets.push([`categories:${MR_LOADER[opts.loader]}`]);
    if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`]);

    const res = await got.get<any>(`${MR_BASE}/search`, {
      searchParams: { query: q, facets: JSON.stringify(facets), limit: opts.limit },
      responseType: "json",
    });
    return (res.body?.hits ?? []).map(
      (h: any): PlatformSearchItem => ({
        source: "modrinth",
        projectId: String(h.project_id),
        slug: h.slug ?? "",
        name: h.title ?? "",
        author: h.author ?? "",
        description: h.description ?? "",
        iconUrl: h.icon_url ?? null,
        downloads: Number(h.downloads ?? 0),
      })
    );
  }

  /**
   * 取某 Modrinth 專案的版本清單，含依賴。
   * @param projectId Modrinth project id 或 slug
   * @param opts mcVersion / loader 透傳過濾、limit（Modrinth 端無 limit 參數，取回後截斷）
   */
  public async listVersions(
    projectId: string,
    opts: { mcVersion?: string; loader?: LoaderName; limit: number }
  ): Promise<PlatformVersion[]> {
    const searchParams: Record<string, string> = {};
    if (opts.loader) searchParams.loaders = JSON.stringify([MR_LOADER[opts.loader]]);
    if (opts.mcVersion) searchParams.game_versions = JSON.stringify([opts.mcVersion]);

    const res = await got.get<any>(`${MR_BASE}/project/${projectId}/version`, {
      searchParams,
      responseType: "json",
    });
    return (res.body ?? []).slice(0, opts.limit).map(normalizeMrVersion);
  }

  /**
   * 批次取 Modrinth 專案資訊（供依賴顯示名稱 / 圖示）；查不到的 id 由上游自動略過。
   * @param projectIds Modrinth project id 陣列
   */
  public async getProjects(projectIds: string[]): Promise<PlatformProject[]> {
    const res = await got.get<any>(`${MR_BASE}/projects`, {
      searchParams: { ids: JSON.stringify(projectIds) },
      responseType: "json",
    });
    return (res.body ?? []).map(
      (p: any): PlatformProject => ({
        projectId: String(p.id),
        name: p.title ?? "",
        slug: p.slug ?? "",
        iconUrl: p.icon_url ?? null,
      })
    );
  }

  /**
   * 取單一 Modrinth 版本的主檔案資訊，供 from-platform 進池。
   * @param versionId Modrinth version id
   */
  public async getVersionFile(versionId: string): Promise<PlatformVersionFile> {
    const res = await got.get<any>(`${MR_BASE}/version/${versionId}`, {
      responseType: "json",
    });
    const file = primaryFile(res.body ?? {});
    if (!file) throw new Error("Modrinth 版本無可用檔案");
    // Modrinth 只提供 sha512/sha1；池下載後親算 sha256，以此 sha512 做完整性核對。
    return {
      fileName: file.filename ?? "",
      sha512: String(file.hashes?.sha512 ?? "").toLowerCase(),
      url: file.url,
      size: Number(file.size ?? 0),
    };
  }
}