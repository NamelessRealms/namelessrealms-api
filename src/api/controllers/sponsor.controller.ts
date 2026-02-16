import { Request, Response } from "express";

import ISponsorUser from "../../interface/sponsor/ISponsorUser";
import SponsorService from "../services/sponsor/sponsor.service";
import VerifyRequestParameter from "../utils/verify/verifyRequestParameter";
import { AppError } from "../utils/response/AppError";

export default class SponsorController {
  private _sponsorService = new SponsorService();

  public async getAllSponsorUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    const sponsorUserListData = await this._sponsorService.getAllSponsorUser();

    if (sponsorUserListData.length !== 0) {
      response.status(200).json(sponsorUserListData);
    } else {
      response.status(204).send();
    }
  }

  public async createSponsorUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    const bodyData: ISponsorUser | ISponsorUser[] = request.body;

    // 確保客戶端必要的參數
    if (!VerifyRequestParameter.verify(bodyData, ["minecraft_uuid", "money"])) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數或者參數格式錯誤。", 400);
    }

    const createSponsorUser =
      await this._sponsorService.createSponsorUser(bodyData);

    if (createSponsorUser.modified) {
      response.status(201).json({
        message: "success",
        info: bodyData,
      });
    } else {
      response.status(304).send();
    }
  }

  public async patchSponsorUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    const uuid = request.params.uuid as string;
    const bodyData: { money: number } = request.body;

    // 確保客戶端必要的參數
    if (!VerifyRequestParameter.verify(bodyData, ["money"], false)) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數或者參數格式錯誤。", 400);
    }

    const patchSponsorUser = await this._sponsorService.patchSponsorUser(
      uuid,
      bodyData.money,
    );

    if (patchSponsorUser.modified) {
      response.status(201).json({
        message: "success",
        info: patchSponsorUser.info,
      });
    } else {
      response.status(304).send();
    }
  }

  public async deleteSponsorUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    const uuid = request.params.uuid as string;
    await this._sponsorService.deleteSponsorUser(uuid);

    response.status(204).send();
  }

  public async getSponsorUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    const uuid = request.params.uuid as string;
    const sponsorUserData = await this._sponsorService.getSponsorUser(uuid);

    if (sponsorUserData !== undefined) {
      response.status(200).json(sponsorUserData);
    } else {
      response.status(204).send();
    }
  }
}
