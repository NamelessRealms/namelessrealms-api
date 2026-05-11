import { Request, Response } from "express";

import UserService from "../services/user/user.service";
import IUserLink from "../../interface/user/IUserLink";
import VerifyRequestParameter from "../utils/verify/verifyRequestParameter";
import { AppError } from "../utils/response/AppError";

interface ILinkMinecraftBody {
  minecraft_uuid: string;
  minecraft_username: string;
}

export default class UserController {
  private _userService = new UserService();

  /**
   * @openapi
   * /user/userLink:
   *   get:
   *     tags:
   *       - User
   *     summary: 取得所有使用者連結資訊
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功取得資料
   */
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

  /**
   * @openapi
   * /user/userLink:
   *   post:
   *     tags:
   *       - User
   *     summary: 建立使用者連結
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               minecraft_uuid:
   *                 type: string
   *               discord_id:
   *                 type: string
   *     responses:
   *       201:
   *         description: 建立成功
   */
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

  /**
   * @openapi
   * /user/userLink/{id}:
   *   get:
   *     tags:
   *       - User
   *     summary: 取得指定使用者連結資訊
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
   *       204:
   *         description: 找不到資料
   */
  public async getUserLink(
    request: Request,
    response: Response,
  ): Promise<void> {
    // minecraft player uuid or discord user id
    const id = request.params.id as string;

    const userLinkData = await this._userService.getUserLink(id);

    if (userLinkData !== undefined) {
      response.status(200).json(userLinkData);
    } else {
      response.status(204).send();
    }
  }

  /**
   * @openapi
   * /user/playerRole/{minecraftUUID}:
   *   get:
   *     tags:
   *       - User
   *     summary: 取得玩家權限組資訊
   *     parameters:
   *       - in: path
   *         name: minecraftUUID
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getPlayerRole(
    request: Request,
    response: Response,
  ): Promise<void> {
    const minecraftUUID = request.params.minecraftUUID as string;

    const playerRoleData = await this._userService.getPlayerRole(minecraftUUID);

    if (playerRoleData !== undefined) {
      response.status(200).json(playerRoleData);
    } else {
      response.status(204).send();
    }
  }

  /**
   * @openapi
   * /user/dashboard:
   *   get:
   *     tags:
   *       - User
   *     summary: 取得後台使用者列表
   *     responses:
   *       200:
   *         description: 成功
   */
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

  /**
   * @openapi
   * /user/dashboard/{id}:
   *   get:
   *     tags:
   *       - User
   *     summary: 取得指定後台使用者資訊
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getPanelUser(
    request: Request,
    response: Response,
  ): Promise<void> {
    // github user id
    const id = request.params.id as string;

    const panelUser = await this._userService.getPanelUser(id);

    if (panelUser !== undefined) {
      response.status(200).json(panelUser);
    } else {
      response.status(204).send();
    }
  }

  /**
   * @openapi
   * /user/minecraft-account:
   *   post:
   *     tags:
   *       - User
   *     summary: 連結 Minecraft 帳號至 Nymless 帳號
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               minecraft_uuid:
   *                 type: string
   *               minecraft_username:
   *                 type: string
   *     responses:
   *       200:
   *         description: 連結成功
   */
  public async linkMinecraftAccount(
    request: Request,
    response: Response,
  ): Promise<void> {
    const userId = request.user?.sub;
    if (!userId) {
      throw new AppError("無法取得使用者身分。", 401);
    }

    const body = request.body as ILinkMinecraftBody;
    if (!VerifyRequestParameter.verify(body, ["minecraft_uuid", "minecraft_username"])) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數或者參數格式錯誤。", 400);
    }

    await this._userService.linkMinecraftAccount(userId, body.minecraft_uuid, body.minecraft_username);
    response.status(200).json({ message: "success" });
  }

  /**
   * @openapi
   * /user/minecraft-account:
   *   get:
   *     tags:
   *       - User
   *     summary: 取得已連結的 Minecraft 帳號
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功取得資料
   *       404:
   *         description: 尚未連結任何 Minecraft 帳號
   */
  public async getLinkedMinecraftAccount(
    request: Request,
    response: Response,
  ): Promise<void> {
    const userId = request.user?.sub;
    if (!userId) {
      throw new AppError("無法取得使用者身分。", 401);
    }

    const account = await this._userService.getLinkedMinecraftAccount(userId);

    if (account !== undefined) {
      response.status(200).json(account);
    } else {
      response.status(404).json({ message: "尚未連結 Minecraft 帳號。" });
    }
  }
}
