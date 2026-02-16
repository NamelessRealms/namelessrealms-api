import { Application, Request, Response } from "express";

import LauncherController from "../controllers/launcher.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class LauncherOldRouter extends IRoutes {
  private _launcherController = new LauncherController();

  constructor(app: Application) {
    super(app);
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/launcherAssets")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getLauncherAssets(req, res),
        ),
      );

    this._routers
      .route("/launcherServerPage")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._launcherController.getLauncherPage(req, res),
        ),
      );
  }
}
