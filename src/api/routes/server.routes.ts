import multer from "multer";
import { Application, Request, Response } from "express";
import ServerController from "../controllers/server.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

const upload = multer({ storage: multer.memoryStorage() });

export default class ServerRouter extends IRoutes {
  private _serverController = new ServerController();

  constructor(app: Application) {
    super(app, "/servers");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._serverController.getServers(req, res)
        )
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.postServer(req, res)
        )
      );

    this._routers
      .route("/:serverId")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._serverController.getServer(req, res)
        )
      )
      .patch(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.patchServer(req, res)
        )
      );

    this._routers
      .route("/:serverId/icon")
      .post(
        this._authJwtVerify.verifyToken,
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.uploadServerMedia(req, res, "icon")
        )
      );

    this._routers
      .route("/:serverId/background")
      .post(
        this._authJwtVerify.verifyToken,
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.uploadServerMedia(req, res, "background")
        )
      );
  }
}