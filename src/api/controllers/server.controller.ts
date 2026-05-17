import { Request, Response } from "express";
import ServerService from "../services/server/server.service";
import { uploadToS3, getExtFromMime } from "../utils/s3/s3";

export default class ServerController {
  private _serverService = new ServerService();

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
    const ownerUserId: string = (request as any).user?.id ?? "unknown";
    const result = await this._serverService.createServer(trimmedName, description, tags, ownerUserId);
    response.status(201).json({ id: result.id, name: trimmedName });
  }

  public async getServers(_request: Request, response: Response): Promise<void> {
    const servers = await this._serverService.getAllServers();
    response.json(servers.map(({ owner_user_id: _, ...pub }) => pub));
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

    const requesterId: string = (request as any).user?.id ?? "";
    if (server.owner_user_id !== requesterId) {
      response.status(403).json({ message: "無權限修改此伺服器" });
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

    const requesterId: string = (request as any).user?.id ?? "";
    if (server.owner_user_id !== requesterId) {
      response.status(403).json({ message: "無權限修改此伺服器" });
      return;
    }

    const file = (request as any).file as Express.Multer.File | undefined;
    if (!file) {
      response.status(400).json({ message: "未提供檔案" });
      return;
    }

    const ext = getExtFromMime(file.mimetype);
    const key = `servers/${serverId}/${mediaType}.${ext}`;
    const url = await uploadToS3(key, file.buffer, file.mimetype);

    await this._serverService.upsertServerMedia(serverId, mediaType, url);
    response.json({ url });
  }
}