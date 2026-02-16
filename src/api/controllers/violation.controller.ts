import { Request, Response } from "express";

import ViolationService from "../services/violation/violation.service";

export default class ViolationController {
  private _violationService = new ViolationService();

  /**
   * @openapi
   * /violation/user/{id}:
   *   get:
   *     tags:
   *       - Violation
   *     summary: 取得違規使用者資訊
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *         description: Minecraft UUID 或 Discord ID
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getViolationUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    // id: minecraft uuid or discord user id
    const id = request.params.id as string;
    const allViolationUserData =
      await this._violationService.getViolationUser(id);

    if (allViolationUserData.length !== 0) {
      response.status(200).json(allViolationUserData);
    } else {
      response.status(204).send();
    }
  }
}
