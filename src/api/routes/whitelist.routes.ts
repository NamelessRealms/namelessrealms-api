import { Application, Request, Response } from "express";

import WhitelistController from "../controllers/whitelist.controllers";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class WhitelistRoutes extends IRoutes {
  private _whitelistController = new WhitelistController();

  constructor(app: Application) {
    super(app, "/whitelist");
  }

  protected _loadRoutes(): void {
    this._routers.route("/awaitVerify").post(
      (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
      asyncHandler((req: Request, res: Response) =>
        this._whitelistController.createAwaitVerify(req, res),
      ),
    );

    this._routers
      .route("/awaitVerify/:discordId")
      .get(
        (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.getAwaitVerify(req, res),
        ),
      )
      .delete(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.deleteAwaitVerify(req, res),
        ),
      );

    this._routers
      .route("/manualVerify")
      .get(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.getAllManualVerify(req, res),
        ),
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.createManualVerify(req, res),
        ),
      );

    this._routers.route("/manualVerify/:discordUserId").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._whitelistController.getManualVerify(req, res),
      ),
    );

    this._routers
      .route("/manualVerify/:channelId/:messageId")
      .get(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.getManualVerifyCIdMId(req, res),
        ),
      )
      .delete(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.deleteManualVerify(req, res),
        ),
      );

    this._routers
      .route("/serverWhitelist")
      .get(
        (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.getAllServerWhitelist(req, res),
        ),
      )
      .post(
        (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.createServerWhitelist(req, res),
        ),
      );

    this._routers
      .route("/serverWhitelist/:minecraftUUID")
      .get(
        (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.getServerWhitelist(req, res),
        ),
      )
      .delete(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.deleteServerWhitelist(req, res),
        ),
      );

    this._routers.route("/serverWhitelist/:minecraftUUID/:serverId").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._whitelistController.getServerWhitelistServerId(req, res),
      ),
    );

    this._routers
      .route("/tpmeVerifyWhitelist")
      .get(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.getAllTpmeVerifyWhitelist(req, res),
        ),
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._whitelistController.createTpmeVerifyWhitelist(req, res),
        ),
      );

    this._routers.route("/tpmeVerifyWhitelist/:discordUserId").delete(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._whitelistController.deleteTpmeVerifyWhitelist(req, res),
      ),
    );
  }
}
