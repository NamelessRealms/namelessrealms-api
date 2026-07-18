/**
 * @file mods.routes.ts
 * @description Mod 路由（前綴 /mods）：批量查詢、批量檔案查詢、單一 Mod 檔案查詢，
 *   以及平台瀏覽 proxy（search / versions / projects，F13a-3）
 * @dependencies ModsController, PlatformController, IRoutes
 */
import { Application, Request, Response } from "express";
import ModsController from "../controllers/mods.controller";
import PlatformController from "../controllers/platform.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class ModsRoutes extends IRoutes {
  private _modsController = new ModsController();
  private _platformController = new PlatformController();

  constructor(app: Application) {
    super(app, "/mods");
  }

  protected _loadRoutes(): void {
    // --- 平台瀏覽 proxy（F13a-3）：僅 JWT，不掛 server 權限（唯讀）。 ---
    // 註冊於 /:projectId/file/:fileId 之前，避免 /platform/* 被誤解析。
    this._routers.get(
      "/platform/search",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._platformController.search(req, res),
      ),
    );
    this._routers.post(
      "/platform/projects",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._platformController.getProjects(req, res),
      ),
    );
    this._routers.get(
      "/platform/:source/:projectId/versions",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._platformController.listVersions(req, res),
      ),
    );

    this._routers.post(
      "",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._modsController.getMods(req, res),
      ),
    );
    this._routers.post(
      "/files",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._modsController.getModFiles(req, res),
      ),
    );
    // metadata 批次查詢：僅 JWT，不掛 server 權限（metadata 跨 server 共用、非敏感）。
    this._routers.post(
      "/metadata/lookup",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._modsController.lookupModMetadata(req, res),
      ),
    );
    this._routers.route("/:projectId/file/:fileId").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._modsController.getMod(req, res),
      ),
    );
  }
}
