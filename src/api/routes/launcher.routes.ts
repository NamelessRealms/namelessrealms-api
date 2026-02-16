import { Application, Request, Response } from "express";

import LauncherController from "../controllers/launcher.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class LauncherRouter extends IRoutes {
  private _launcherController = new LauncherController();

  constructor(app: Application) {
    super(app, "/launcher");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/assets")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getLauncherAssets(req, res),
        ),
      );

    this._routers
      .route("/page")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getLauncherPage(req, res),
        ),
      )
      .put(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.putLauncherPage(req, res),
        ),
      );

    this._routers
      .route("/autoUpdater/updates/RELEASES")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getAutoUpdaterLatest(req, res),
        ),
      );

    this._routers
      .route("/autoUpdater/updates/:fileName")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getAutoUpdaterLatestNupkg(req, res),
        ),
      );
  }
}
