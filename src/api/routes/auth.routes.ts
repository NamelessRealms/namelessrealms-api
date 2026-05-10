import { Application, Request, Response } from "express";

import AuthController from "../controllers/auth.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";
import { loginLimiter, sendCodeLimiter } from "../middlewares/rateLimiters";

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
  }
}
