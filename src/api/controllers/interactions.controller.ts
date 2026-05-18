/**
 * @file interactions.controller.ts
 * @description 處理外部應用程式互動回呼的 HTTP 請求，追蹤 IP 存活狀態
 * @methods
 *   - createInteraction: 記錄來源 IP 的 ping 紀錄
 *   - pingInteraction: 確認應用程式連線並加入互動 Map
 * @dependencies InteractionsService
 */
import { Request, Response } from "express";
import InteractionsService from "../services/Interactions/Interactions.service";

export default class InteractionsController {
  private _interactionsService = new InteractionsService();

  /**
   * @openapi
   * /interactions/{appId}/callback:
   *   post:
   *     tags:
   *       - Interactions
   *     summary: 建立互動回呼 (Ping)
   *     parameters:
   *       - in: path
   *         name: appId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 成功
   */
  public async createInteraction(
    request: Request,
    response: Response,
  ): Promise<void> {
    const appId = request.params.appId as string;
    const ip = request.ip as string;

    this._interactionsService.addInteractionCallbackPing(appId, ip);

    response.status(200).json({
      type: "ping",
    });
  }

  /**
   * @openapi
   * /interactions/{appId}/callback/ping:
   *   post:
   *     tags:
   *       - Interactions
   *     summary: 互動回呼存活檢查
   *     parameters:
   *       - in: path
   *         name: appId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       201:
   *         description: 建立成功
   */
  public async pingInteraction(
    request: Request,
    response: Response,
  ): Promise<void> {
    const appId = request.params.appId as string;
    const ip = request.ip as string;

    const isAdd = this._interactionsService.addInteractionCallback(appId, ip);

    if (isAdd) {
      response.status(201).send();
    } else {
      response.status(400).send();
    }
  }
}
