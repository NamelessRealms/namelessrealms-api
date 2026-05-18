/**
 * @file user.routes.ts
 * @description 使用者路由（前綴 /user）：帳號連結、玩家角色、後台使用者、Minecraft 帳號連結
 * @dependencies UserController, IRoutes
 */
import { Application, Request, Response } from "express";

import IRoutes from "./IRoutes";
import UserController from "../controllers/user.controller";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class UserRouter extends IRoutes {
  private _userController = new UserController();

  constructor(app: Application) {
    super(app, "/user");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/userLink")
      .get(
        (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
        asyncHandler((req: Request, res: Response) =>
          this._userController.getAllUserLink(req, res),
        ),
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._userController.createUserLink(req, res),
        ),
      );

    // id: minecraft player uuid or discord user id
    this._routers.route("/userLink/:id").get(
      (req, res, next) => this._verifyApiKey.verifyOrJwt(req, res, next),
      asyncHandler((req: Request, res: Response) =>
        this._userController.getUserLink(req, res),
      ),
    );

    this._routers.route("/playerRole/:minecraftUUID").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._userController.getPlayerRole(req, res),
      ),
    );

    this._routers.route("/dashboard").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._userController.getPanelUsers(req, res),
      ),
    );

    this._routers.route("/dashboard/:id").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._userController.getPanelUser(req, res),
      ),
    );

    this._routers
      .route("/minecraft-account")
      .get(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._userController.getLinkedMinecraftAccount(req, res),
        ),
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._userController.linkMinecraftAccount(req, res),
        ),
      );
  }
}
