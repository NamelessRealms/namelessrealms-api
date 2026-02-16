import { Request, Response } from "express";
import InteractionsService from "../services/Interactions/Interactions.service";

export default class InteractionsController {
  private _interactionsService = new InteractionsService();

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
