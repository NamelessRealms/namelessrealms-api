/**
 * @file server.controller.ts
 * @description 處理社群伺服器 CRUD 與媒體上傳的 HTTP 請求
 * @methods
 *   - postServer: 建立新伺服器
 *   - getServers: 取得所有伺服器列表（過濾 owner_user_id）
 *   - getServer: 取得單一伺服器資訊
 *   - getMyMembership: 取得呼叫者於該伺服器的有效權限（owner 回 ADMINISTRATOR）
 *   - patchServer: 更新伺服器設定（需為擁有者）
 *   - uploadServerMedia: 上傳伺服器 icon 或 background 至 S3/MinIO
 * @dependencies ServerService, ServerMemberService, permissions, s3 utils
 * @notes 回傳給前端時會移除 owner_user_id 欄位以保護隱私
 */
import { Request, Response } from "express";
import ServerService from "../services/server/server.service";
import ServerMemberService from "../services/server/server-member.service";
import { Permission } from "../utils/permissions";
import { uploadToS3, getExtFromMime, deleteFromS3, keyFromUrl } from "../utils/s3/s3";

export default class ServerController {
  private _serverService = new ServerService();
  private _memberService = new ServerMemberService();

  public async postServer(request: Request, response: Response): Promise<void> {
    const { name, description = "", tags = [] } = request.body;
    if (!name?.trim()) {
      response.status(400).json({ message: "伺服器名稱為必填" });
      return;
    }
    const trimmedName = name.trim();
    const taken = await this._serverService.isNameTaken(trimmedName);
    if (taken) {
      response.status(409).json({ code: "Conflict", message: "此伺服器名稱已被使用" });
      return;
    }
    const ownerUserId: string = (request as any).user?.sub ?? "";
    const result = await this._serverService.createServer(trimmedName, description, tags, ownerUserId);
    response.status(201).json({ id: result.id, name: trimmedName });
  }

  public async getServers(_request: Request, response: Response): Promise<void> {
    const cards = await this._serverService.getServerCards();
    response.json(cards.map(({ owner_user_id: _, ...pub }) => pub));
  }

  public async getServer(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const server = await this._serverService.getServerById(serverId);
    if (!server) {
      response.status(404).json({ message: "找不到該伺服器" });
      return;
    }
    const { owner_user_id: _, ...publicFields } = server;
    response.json(publicFields);
  }

  /**
   * 取得呼叫者於指定伺服器的有效權限。
   *
   * owner（servers.owner_user_id）回傳 ADMINISTRATOR（與後端權限檢查的 owner 放行語意一致）；
   * 一般成員回傳其角色 permissions；非成員回傳 0。同時回傳呼叫者的 user_id 供前端辨識自身。
   */
  public async getMyMembership(request: Request, response: Response): Promise<void> {
    const userId: string = (request as any).user?.sub ?? "";
    const serverId = request.params.serverId as string;
    const server = await this._serverService.getServerById(serverId);
    if (!server) {
      response.status(404).json({ message: "找不到該伺服器" });
      return;
    }
    if (server.owner_user_id === userId) {
      response.json({ is_owner: true, permissions: Permission.ADMINISTRATOR, user_id: userId });
      return;
    }
    const member = await this._memberService.getMemberWithRole(serverId, userId);
    response.json({
      is_owner: false,
      permissions: member?.role.permissions ?? 0,
      user_id: userId,
    });
  }

  public async patchServer(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const { name, description = "", tags = [] } = request.body;

    if (!name?.trim()) {
      response.status(400).json({ message: "伺服器名稱為必填" });
      return;
    }
    const trimmedName = name.trim();

    const server = await this._serverService.getServerById(serverId);
    if (!server) {
      response.status(404).json({ message: "找不到該伺服器" });
      return;
    }

    if (trimmedName !== server.name) {
      const taken = await this._serverService.isNameTakenByOther(trimmedName, serverId);
      if (taken) {
        response.status(409).json({ code: "Conflict", message: "此伺服器名稱已被使用" });
        return;
      }
    }

    await this._serverService.updateServer(serverId, trimmedName, description, tags);
    response.json({ id: serverId, name: trimmedName });
  }

  public async uploadServerMedia(
    request: Request,
    response: Response,
    mediaType: "icon" | "background"
  ): Promise<void> {
    const serverId = request.params.serverId as string;

    const server = await this._serverService.getServerById(serverId);
    if (!server) {
      response.status(404).json({ message: "找不到該伺服器" });
      return;
    }

    const file = (request as any).file as Express.Multer.File | undefined;
    if (!file) {
      response.status(400).json({ message: "未提供檔案" });
      return;
    }

    const existingUrl = mediaType === "icon" ? server.icon_url : server.background_url;
    if (existingUrl) {
      const oldKey = keyFromUrl(existingUrl);
      if (oldKey) await deleteFromS3(oldKey);
    }

    const ext = getExtFromMime(file.mimetype);
    const key = `servers/${serverId}/${mediaType}.${ext}`;
    const url = await uploadToS3(key, file.buffer, file.mimetype);

    await this._serverService.upsertServerMedia(serverId, mediaType, url);
    response.json({ url });
  }

  public async deleteServerMedia(
    request: Request,
    response: Response,
    mediaType: "icon" | "background"
  ): Promise<void> {
    const serverId = request.params.serverId as string;

    const server = await this._serverService.getServerById(serverId);
    if (!server) {
      response.status(404).json({ message: "找不到該伺服器" });
      return;
    }

    const mediaUrl = mediaType === "icon" ? server.icon_url : server.background_url;
    if (mediaUrl) {
      const key = keyFromUrl(mediaUrl);
      if (key) await deleteFromS3(key);
    }

    await this._serverService.deleteServerMedia(serverId, mediaType);
    response.status(204).send();
  }
}