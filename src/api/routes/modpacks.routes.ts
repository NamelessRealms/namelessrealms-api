/**
 * @file modpacks.routes.ts
 * @description Modpack 路由（前綴 /modpacks）：單一 Modpack 檔案查詢（無需驗證）
 * @dependencies ModsController, IRoutes
 */
import { Application, Request, Response } from "express";
import ModsController from "../controllers/mods.controller";

import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class ModpacksRoutes extends IRoutes {
  private _modsController = new ModsController();

  constructor(app: Application) {
    super(app, "/modpacks");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/:projectId/file/:fileId")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._modsController.getMod(req, res),
        ),
      );
  }
}
