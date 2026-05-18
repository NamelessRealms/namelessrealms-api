/**
 * @file mods.routes.ts
 * @description Mod 路由（前綴 /mods）：批量查詢、批量檔案查詢與單一 Mod 檔案查詢
 * @dependencies ModsController, IRoutes
 */
import { Application, Request, Response } from "express";
import ModsController from "../controllers/mods.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class ModsRoutes extends IRoutes {
  private _modsController = new ModsController();

  constructor(app: Application) {
    super(app, "/mods");
  }

  protected _loadRoutes(): void {
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
    this._routers.route("/:projectId/file/:fileId").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._modsController.getMod(req, res),
      ),
    );
  }
}
