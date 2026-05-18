/**
 * @file launcherV2.routes.ts
 * @description Launcher V2 路由（前綴 /launcher/v2）：V2 資產設定讀寫與 Discord Webhook 轉發
 * @dependencies LauncherController, multer, IRoutes
 */
import { Application, Request, Response } from "express";
import multer from "multer";
import LauncherController from "../controllers/launcher.controller";

import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class LauncherV2Router extends IRoutes {
  private _launcherController = new LauncherController();

  constructor(app: Application) {
    super(app, "/launcher/v2");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/assets")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getLauncherAssetsV2(req, res),
        ),
      )
      .put(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.putLauncherAssetsV2(req, res),
        ),
      );

    this._routers.route("/webhooks/discord").post(
      this._authJwtVerify.verifyToken,
      multer().any() as any,
      asyncHandler((req: Request, res: Response) =>
        this._launcherController.postDiscordWebhooks(req, res),
      ),
    );
  }
}
