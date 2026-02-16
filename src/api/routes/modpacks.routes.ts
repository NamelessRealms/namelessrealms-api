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
