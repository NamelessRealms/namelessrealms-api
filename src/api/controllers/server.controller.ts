import { Request, Response } from "express";
import ServerService from "../services/server/server.service";

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
}
