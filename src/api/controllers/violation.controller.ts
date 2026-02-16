import { Request, Response } from "express";

import ViolationService from "../services/violation/violation.service";

export default class ViolationController {
  private _violationService = new ViolationService();

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
