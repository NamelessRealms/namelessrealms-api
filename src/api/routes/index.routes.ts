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
