/**
 * @file sponsor.controller.ts
 * @description 處理贊助者紀錄 CRUD 的 HTTP 請求
 * @methods
 *   - getAllSponsorUser: 取得所有贊助者列表
 *   - createSponsorUser: 新增贊助紀錄
 *   - patchSponsorUser: 累加贊助金額
 *   - deleteSponsorUser: 刪除贊助紀錄
 *   - getSponsorUser: 取得單一贊助者資訊
 * @dependencies SponsorService, VerifyRequestParameter, AppError
 */
import { Request, Response } from "express";

import ISponsorUser from "../../interface/sponsor/ISponsorUser";
import SponsorService from "../services/sponsor/sponsor.service";
import VerifyRequestParameter from "../utils/verify/verifyRequestParameter";
import { AppError } from "../utils/response/AppError";

export default class SponsorController {
  private _sponsorService = new SponsorService();

  /**
   * @openapi
   * /sponsor/user:
   *   get:
   *     tags:
   *       - Sponsor
   *     summary: 取得所有贊助者列表
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功
   */
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

  /**
   * @openapi
   * /sponsor/user:
   *   post:
   *     tags:
   *       - Sponsor
   *     summary: 新增贊助紀錄
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - minecraft_uuid
   *               - money
   *             properties:
   *               minecraft_uuid:
   *                 type: string
   *               money:
   *                 type: number
   *     responses:
   *       201:
   *         description: 建立成功
   */
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

  /**
   * @openapi
   * /sponsor/user/{uuid}:
   *   patch:
   *     tags:
   *       - Sponsor
   *     summary: 修改贊助金額
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: uuid
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               money:
   *                 type: number
   *     responses:
   *       201:
   *         description: 修改成功
   */
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

  /**
   * @openapi
   * /sponsor/user/{uuid}:
   *   delete:
   *     tags:
   *       - Sponsor
   *     summary: 刪除贊助紀錄
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: uuid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       204:
   *         description: 刪除成功
   */
  public async deleteSponsorUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    const uuid = request.params.uuid as string;
    await this._sponsorService.deleteSponsorUser(uuid);

    response.status(204).send();
  }

  /**
   * @openapi
   * /sponsor/user/{uuid}:
   *   get:
   *     tags:
   *       - Sponsor
   *     summary: 取得單一贊助者資訊
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: uuid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 成功
   */
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
