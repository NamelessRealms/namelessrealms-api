import { Request, Response } from "express";

import UserService from "../services/user/user.service";
import IUserLink from "../../interface/user/IUserLink";
import VerifyRequestParameter from "../utils/verify/verifyRequestParameter";
import { AppError } from "../utils/response/AppError";

export default class UserController {
  private _userService = new UserService();

  public async getAllUserLink(
    request: Request,
    response: Response,
  ): Promise<void> {
    const userLinkData = await this._userService.getAllUserLink();

    if (userLinkData.length !== 0) {
      response.status(200).json(userLinkData);
    } else {
      response.status(204).send();
    }
  }

  public async createUserLink(
    request: Request,
    response: Response,
  ): Promise<void> {
    const bodyData: IUserLink | IUserLink[] = request.body;

    // 確保客戶端必要的參數
    if (
      !VerifyRequestParameter.verify(bodyData, ["minecraft_uuid", "discord_id"])
    ) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數或者參數格式錯誤。", 400);
    }

    const createUserLink = await this._userService.createUserLink(bodyData);

    if (createUserLink.modified) {
      response.status(201).json({
        message: "success",
        info: bodyData,
      });
    } else {
      response.status(304).send();
    }
  }

  public async getUserLink(
    request: Request,
    response: Response,
  ): Promise<void> {
    // minecraft player uuid or discord user id
    const id = request.params.id;

    const userLinkData = await this._userService.getUserLink(id);

    if (userLinkData !== undefined) {
      response.status(200).json(userLinkData);
    } else {
      response.status(204).send();
    }
  }

  public async getPlayerRole(
    request: Request,
    response: Response,
  ): Promise<void> {
    const minecraftUUID = request.params.minecraftUUID;

    const playerRoleData = await this._userService.getPlayerRole(minecraftUUID);

    if (playerRoleData !== undefined) {
      response.status(200).json(playerRoleData);
    } else {
      response.status(204).send();
    }
  }

  public async getPanelUsers(
    request: Request,
    response: Response,
  ): Promise<void> {
    const panelUsers = await this._userService.getPanelUsers();

    if (panelUsers.length !== 0) {
      response.status(200).json(panelUsers);
    } else {
      response.status(204).send();
    }
  }

  public async getPanelUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    // github user id
    const id = request.params.id;

    const panelUser = await this._userService.getPanelUser(id);

    if (panelUser !== undefined) {
      response.status(200).json(panelUser);
    } else {
      response.status(204).send();
    }
  }
}
