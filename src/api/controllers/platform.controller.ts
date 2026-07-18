/**
 * @file platform.controller.ts
 * @description 模組平台瀏覽 proxy（F13a-3）：搜尋 / 版本清單 / 批次專案資訊。薄層 handler，
 *   委派 platform-curseforge / platform-modrinth service，負責參數驗證、來源 gating 與合併。
 * @methods
 *   - search: GET /mods/platform/search（source=all 並發兩平台合併）
 *   - listVersions: GET /mods/platform/:source/:projectId/versions
 *   - getProjects: POST /mods/platform/projects
 * @dependencies PlatformCurseforgeService, PlatformModrinthService, config（CF key）, AppError
 */
import { Request, Response } from "express";
import PlatformCurseforgeService from "../services/mods/platform-curseforge.service";
import PlatformModrinthService from "../services/mods/platform-modrinth.service";
import { LoaderName, PlatformSearchItem } from "../services/mods/platform.types";
import { config } from "../../config/config.service";
import { AppError } from "../utils/response/AppError";

/** limit 缺省與上限 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** projects 批次上限 */
const MAX_PROJECT_IDS = 50;

const VALID_SOURCES = new Set(["curseforge", "modrinth"]);
const VALID_LOADERS = new Set(["Forge", "Fabric", "NeoForge", "Quilt"]);

/** 夾制 limit 到 [1, MAX_LIMIT]，非法/缺省回 DEFAULT_LIMIT */
function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/** 驗證並取 loader 查詢參數（缺省 undefined；帶了非法值 → 400） */
function parseLoader(raw: unknown): LoaderName | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !VALID_LOADERS.has(raw)) {
    throw new AppError("loader 僅接受 Forge | Fabric | NeoForge | Quilt", 400);
  }
  return raw as LoaderName;
}

export default class PlatformController {
  private _cf = new PlatformCurseforgeService();
  private _mr = new PlatformModrinthService();

  /**
   * @openapi
   * /mods/platform/search:
   *   get:
   *     tags: [Platform]
   *     summary: 搜尋 CurseForge / Modrinth 模組（正規化統一形狀）
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功；回正規化 search item 陣列
   */
  public async search(req: Request, res: Response): Promise<void> {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q) throw new AppError("q 為必填", 400);

    const source = (req.query.source as string) || "all";
    if (source !== "all" && !VALID_SOURCES.has(source)) {
      throw new AppError("source 僅接受 all | curseforge | modrinth", 400);
    }
    const mcVersion = (req.query.mcVersion as string) || undefined;
    const loader = parseLoader(req.query.loader);
    const limit = clampLimit(req.query.limit);
    const opts = { mcVersion, loader, limit };

    const wantCf = source === "all" || source === "curseforge";
    const wantMr = source === "all" || source === "modrinth";

    // CF 需 key：明指 curseforge 缺 key → 503；all 缺 key → 靜默跳過 CF。
    if (source === "curseforge" && !config.curseforgeKey) {
      throw new AppError("CurseForge 服務未設定", 503, "ServiceUnavailable");
    }
    const runCf = wantCf && !!config.curseforgeKey;

    const tasks: Array<{ src: string; p: Promise<PlatformSearchItem[]> }> = [];
    if (runCf) tasks.push({ src: "curseforge", p: this._cf.search(q, opts) });
    if (wantMr) tasks.push({ src: "modrinth", p: this._mr.search(q, opts) });

    const settled = await Promise.allSettled(tasks.map((t) => t.p));

    // 明指單一來源時，該來源失敗 → 502；all 時靜默略過失敗來源、回成功者聯集。
    const merged: PlatformSearchItem[] = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") {
        merged.push(...r.value);
      } else if (source !== "all") {
        throw new AppError(`${tasks[i].src} 搜尋失敗`, 502, "BadGateway");
      }
    });

    res.status(200).json(merged);
  }

  /**
   * @openapi
   * /mods/platform/{source}/{projectId}/versions:
   *   get:
   *     tags: [Platform]
   *     summary: 取某平台專案的版本清單（含依賴）
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功；回正規化 version 陣列
   */
  public async listVersions(req: Request, res: Response): Promise<void> {
    const source = req.params.source as string;
    const projectId = req.params.projectId as string;
    if (!VALID_SOURCES.has(source)) {
      throw new AppError("source 僅接受 curseforge | modrinth", 400);
    }
    const mcVersion = (req.query.mcVersion as string) || undefined;
    const loader = parseLoader(req.query.loader);
    const limit = clampLimit(req.query.limit);
    const opts = { mcVersion, loader, limit };

    try {
      const versions =
        source === "curseforge"
          ? await this._cfWithKey((s) => s.listVersions(projectId, opts))
          : await this._mr.listVersions(projectId, opts);
      res.status(200).json(versions);
    } catch (err) {
      throw this._toGatewayError(err, "取版本清單失敗");
    }
  }

  /**
   * @openapi
   * /mods/platform/projects:
   *   post:
   *     tags: [Platform]
   *     summary: 批次取平台專案資訊（供依賴顯示名稱 / 圖示）
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功；回 project 陣列（查不到者略過）
   */
  public async getProjects(req: Request, res: Response): Promise<void> {
    const { source, projectIds } = req.body ?? {};
    if (!VALID_SOURCES.has(source)) {
      throw new AppError("source 僅接受 curseforge | modrinth", 400);
    }
    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      throw new AppError("projectIds 為必填且需為非空陣列", 400);
    }
    if (projectIds.length > MAX_PROJECT_IDS) {
      throw new AppError(`projectIds 上限為 ${MAX_PROJECT_IDS} 筆`, 400);
    }
    const ids = projectIds.map((id: unknown) => String(id));

    try {
      const projects =
        source === "curseforge"
          ? await this._cfWithKey((s) => s.getProjects(ids))
          : await this._mr.getProjects(ids);
      res.status(200).json(projects);
    } catch (err) {
      throw this._toGatewayError(err, "取專案資訊失敗");
    }
  }

  /** 執行 CF service 前先 gate key（缺 → 503）；透傳結果 */
  private async _cfWithKey<T>(
    fn: (s: PlatformCurseforgeService) => Promise<T>
  ): Promise<T> {
    if (!config.curseforgeKey) {
      throw new AppError("CurseForge 服務未設定", 503, "ServiceUnavailable");
    }
    return fn(this._cf);
  }

  /** 上游錯誤 → 502；已是 AppError（如 503 gate）則原樣拋出 */
  private _toGatewayError(err: unknown, message: string): AppError {
    if (err instanceof AppError) return err;
    return new AppError(message, 502, "BadGateway");
  }
}