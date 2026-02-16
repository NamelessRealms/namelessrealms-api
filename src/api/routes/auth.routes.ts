import { Application, Request, Response } from "express";

import AuthController from "../controllers/auth.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class AuthRoutes extends IRoutes {
  private _authController: AuthController = new AuthController();

  constructor(app: Application) {
    super(app);
  }

  protected _loadRoutes(): void {
    this._routers.post(
      "/oauth2/token",
      asyncHandler((req: Request, res: Response) =>
        this._authController.login(req, res),
      ),
    );
  }
}
