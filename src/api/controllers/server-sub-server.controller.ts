/**
 * @file server-sub-server.controller.ts
 * @description 處理子伺服器（server_sub_servers）CRUD 的 HTTP 請求
 * @methods
 *   - getSubServers: 列出品牌伺服器底下所有子伺服器（公開）
 *   - getSubServer: 取得單一子伺服器（公開）
 *   - createSubServer: 建立子伺服器（需 MANAGE_SERVER）
 *   - updateSubServer: 更新子伺服器（需 MANAGE_SERVER）
 *   - deleteSubServer: 刪除子伺服器（需 MANAGE_SERVER）
 * @notes
 *   - is_online / player_count 由 heartbeat 餵，不由 CRUD 設定
 *   - sync_mode 僅接受 'strict' / 'additive'
 */
import { Request, Response } from "express";
import ServerSubServerService, {
  SubServerInput,
  SyncMode,
} from "../services/server/server-sub-server.service";

const subServerService = new ServerSubServerService();

const VALID_SYNC_MODES: SyncMode[] = ["strict", "additive"];

export default class ServerSubServerController {
  /** 取得品牌伺服器底下所有子伺服器列表（公開，不需認證） */
  public async getSubServers(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServers = await subServerService.getSubServers(serverId);
    response.json(subServers);
  }

  /** 取得單一子伺服器（公開，不需認證） */
  public async getSubServer(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServerId = request.params.subServerId as string;

    const subServer = await subServerService.getSubServerById(subServerId);
    if (!subServer || subServer.server_id !== serverId) {
      response.status(404).json({ message: "找不到該子伺服器" });
      return;
    }
    response.json(subServer);
  }

  /** 建立子伺服器（需 MANAGE_SERVER 權限） */
  public async createSubServer(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const input = this._parseInput(request, response);
    if (!input) return;

    const result = await subServerService.createSubServer(serverId, input);
    response.status(201).json(result);
  }

  /** 更新子伺服器（需 MANAGE_SERVER 權限） */
  public async updateSubServer(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServerId = request.params.subServerId as string;

    const existing = await subServerService.getSubServerById(subServerId);
    if (!existing || existing.server_id !== serverId) {
      response.status(404).json({ message: "找不到該子伺服器" });
      return;
    }

    const input = this._parseInput(request, response, existing);
    if (!input) return;

    await subServerService.updateSubServer(subServerId, input);
    response.json({ id: subServerId });
  }

  /** 刪除子伺服器（需 MANAGE_SERVER 權限） */
  public async deleteSubServer(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServerId = request.params.subServerId as string;

    const existing = await subServerService.getSubServerById(subServerId);
    if (!existing || existing.server_id !== serverId) {
      response.status(404).json({ message: "找不到該子伺服器" });
      return;
    }

    await subServerService.deleteSubServer(subServerId);
    response.status(204).send();
  }

  /**
   * 解析並驗證請求 body 為 SubServerInput。
   * 驗證失敗時直接回應 400 並回傳 null；`fallback` 提供更新時的既有值作為預設。
   */
  private _parseInput(
    request: Request,
    response: Response,
    fallback?: SubServerInput
  ): SubServerInput | null {
    const { name, icon_url, host, port, sync_mode, position } = request.body;

    const resolvedName = (name ?? fallback?.name)?.toString().trim();
    const resolvedHost = (host ?? fallback?.host)?.toString().trim();
    if (!resolvedName) {
      response.status(400).json({ message: "name 為必填" });
      return null;
    }
    if (!resolvedHost) {
      response.status(400).json({ message: "host 為必填" });
      return null;
    }

    const resolvedSyncMode: SyncMode = sync_mode ?? fallback?.sync_mode ?? "strict";
    if (!VALID_SYNC_MODES.includes(resolvedSyncMode)) {
      response.status(400).json({ message: "sync_mode 僅接受 'strict' 或 'additive'" });
      return null;
    }

    return {
      name: resolvedName,
      icon_url: icon_url ?? fallback?.icon_url ?? null,
      host: resolvedHost,
      port: Number(port ?? fallback?.port ?? 25565),
      sync_mode: resolvedSyncMode,
      position: Number(position ?? fallback?.position ?? 0),
    };
  }
}
