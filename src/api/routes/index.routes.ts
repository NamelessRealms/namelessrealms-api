/**
 * @file index.routes.ts
 * @description 根路由，提供 GET / 與 GET /status 的健康狀態回應
 * @methods sendStatusResponse: 回傳版本號、timestamp 與請求 IP
 * @dependencies environment, IRoutes
 */
import { Application, Request, Response } from "express";
import { environment } from "../../environment/environment";

import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class IndexRoutes extends IRoutes {
  constructor(app: Application) {
    super(app);
  }

  protected _loadRoutes(): void {
    this._routers.get(
      "/",
      asyncHandler((req: Request, res: Response) => {
        this.sendStatusResponse(req, res);
      }),
    );

    /**
     * GET /status
     */
    this._routers.get(
      "/status",
      asyncHandler((req: Request, res: Response) => {
        this.sendStatusResponse(req, res);
      }),
    );
  }

  public sendStatusResponse(request: Request, response: Response) {
    response.status(200).json({
      message: "OK",
      version: environment.api_version,
      timestamp: new Date().toISOString(),
      ip: request.ip,
      url: request.originalUrl,
    });
  }
}
