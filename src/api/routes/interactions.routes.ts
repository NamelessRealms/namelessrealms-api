import { Application, Request, Response } from "express";
import InteractionsController from "../controllers/interactions.controller";

import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class InteractionsRouter extends IRoutes {
  private _interactionsController = new InteractionsController();

  constructor(app: Application) {
    super(app, "/interactions");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/:appId/callback")
      .post(
        asyncHandler((req: Request, res: Response) =>
          this._interactionsController.createInteraction(req, res),
        ),
      );

    this._routers
      .route("/:appId/callback/ping")
      .post(
        asyncHandler((req: Request, res: Response) =>
          this._interactionsController.pingInteraction(req, res),
        ),
      );
  }
}
