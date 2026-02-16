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
      asyncHandler((req: Request, res: Response) =>
        this._modsController.getMods(req, res),
      ),
    );
    this._routers.post(
      "/files",
      asyncHandler((req: Request, res: Response) =>
        this._modsController.getModFiles(req, res),
      ),
    );
    this._routers
      .route("/:projectId/file/:fileId")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._modsController.getMod(req, res),
        ),
      );
  }
}
