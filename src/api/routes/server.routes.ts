import { Application, Request, Response } from "express";
import ServerController from "../controllers/server.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class ServerRouter extends IRoutes {
  private _serverController = new ServerController();

  constructor(app: Application) {
    super(app, "/servers");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/")
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.postServer(req, res)
        )
      );
  }
}
