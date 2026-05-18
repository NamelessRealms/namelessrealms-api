/**
 * @file violation.routes.ts
 * @description 違規路由（前綴 /violation）：GET /user/:id 查詢違規紀錄
 * @dependencies ViolationController, IRoutes
 */
import { Application, Request, Response } from "express";

import ViolationController from "../controllers/violation.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class ViolationRouter extends IRoutes {
  private _violationController = new ViolationController();

  constructor(app: Application) {
    super(app, "/violation");
  }

  protected _loadRoutes(): void {
    this._routers.route("/user/:id").get(
      this._authJwtVerify.verifyToken,
      asyncHandler((req: Request, res: Response) =>
        this._violationController.getViolationUser(req, res),
      ),
    );
  }
}
