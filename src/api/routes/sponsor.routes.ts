import { Application, Request, Response } from "express";

import SponsorController from "../controllers/sponsor.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";

export default class SponsorRouter extends IRoutes {
  private _sponsorController = new SponsorController();

  constructor(app: Application) {
    super(app, "/sponsor");
  }

  protected _loadRoutes(): void {
    this._routers
      .route("/user")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._sponsorController.getAllSponsorUser(req, res),
        ),
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._sponsorController.createSponsorUser(req, res),
        ),
      );

    this._routers
      .route("/user/:uuid")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._sponsorController.getSponsorUser(req, res),
        ),
      )
      .patch(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._sponsorController.patchSponsorUser(req, res),
        ),
      )
      .delete(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._sponsorController.deleteSponsorUser(req, res),
        ),
      );
  }
}
