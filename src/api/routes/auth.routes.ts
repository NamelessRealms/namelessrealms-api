/**
 * @file auth.routes.ts
 * @description 認證相關路由：POST /oauth2/token、POST /register、POST /auth/send-code、GET /auth/validate、POST /auth/logout
 * @dependencies AuthController, IRoutes, rateLimiters
 */
import { Application, Request, Response } from "express";

import AuthController from "../controllers/auth.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";
import { loginLimiter, logoutLimiter, sendCodeLimiter } from "../middlewares/rateLimiters";

export default class AuthRoutes extends IRoutes {
  private _authController: AuthController = new AuthController();

  constructor(app: Application) {
    super(app);
  }

  protected _loadRoutes(): void {
    this._routers.post(
      "/oauth2/token",
      loginLimiter,
      asyncHandler((req: Request, res: Response) =>
        this._authController.login(req, res),
      ),
    );

    this._routers.post(
      "/register",
      asyncHandler((req: Request, res: Response) =>
        this._authController.register(req, res),
      ),
    );

    this._routers.post(
      "/auth/send-code",
      sendCodeLimiter,
      asyncHandler((req: Request, res: Response) =>
        this._authController.sendCode(req, res),
      ),
    );

    // ⛔ 刻意不掛 this._authJwtVerify.verifyToken：持有 refresh token 本身即為憑證，
    //    且 access token 可能已過期——那正是最需要登出的情境。
    this._routers.post(
      "/auth/logout",
      logoutLimiter,
      asyncHandler((req: Request, res: Response) =>
        this._authController.logout(req, res),
      ),
    );

    this._routers.get(
      "/auth/validate",
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._authController.validateSession(req, res),
      ),
    );
  }
}
