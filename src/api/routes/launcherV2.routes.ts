import { Application, Request, Response } from "express";
import * as multer from "multer";
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
      multer().any(),
      asyncHandler((req: Request, res: Response) =>
        this._launcherController.postDiscordWebhooks(req, res),
      ),
    );
  }
}
