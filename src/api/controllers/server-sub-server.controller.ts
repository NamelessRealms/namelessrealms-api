/**
 * @file server-sub-server.controller.ts
 * @description 處理子伺服器（server_sub_servers）CRUD 的 HTTP 請求
 * @methods
 *   - getSubServers: 列出品牌伺服器底下所有子伺服器（公開）
 *   - getSubServer: 取得單一子伺服器（公開）
 *   - createSubServer: 建立子伺服器（需 MANAGE_SERVER）
 *   - updateSubServer: 更新子伺服器（需 MANAGE_SERVER）
 *   - deleteSubServer: 刪除子伺服器（需 MANAGE_SERVER）
 *   - getSubServerMedia: 列出子伺服器媒體展示區圖片（公開）
 *   - uploadSubServerMedia: 上傳一張媒體展示區圖片至 S3/MinIO（需 MANAGE_SERVER）
 *   - deleteSubServerMedia: 刪除一張媒體展示區圖片（需 MANAGE_SERVER）
 * @notes
 *   - is_online / player_count 由 heartbeat 餵，不由 CRUD 設定
 *   - sync_mode 僅接受 'strict' / 'additive'
 */
import { Request, Response } from "express";
import ServerSubServerService, {
  SubServerInput,
  SyncMode,
} from "../services/server/server-sub-server.service";
import { uploadToS3, getExtFromMime, deleteFromS3, keyFromUrl } from "../utils/s3/s3";

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

  /** 列出子伺服器媒體展示區圖片（公開，不需認證） */
  public async getSubServerMedia(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServerId = request.params.subServerId as string;

    const subServer = await subServerService.getSubServerById(subServerId);
    if (!subServer || subServer.server_id !== serverId) {
      response.status(404).json({ message: "找不到該子伺服器" });
      return;
    }
    response.json(await subServerService.getSubServerMedia(subServerId));
  }

  /** 上傳一張媒體展示區圖片至 S3/MinIO（需 MANAGE_SERVER 權限） */
  public async uploadSubServerMedia(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServerId = request.params.subServerId as string;

    const subServer = await subServerService.getSubServerById(subServerId);
    if (!subServer || subServer.server_id !== serverId) {
      response.status(404).json({ message: "找不到該子伺服器" });
      return;
    }

    const file = (request as any).file as Express.Multer.File | undefined;
    if (!file) {
      response.status(400).json({ message: "未提供檔案" });
      return;
    }

    const mediaId = crypto.randomUUID();
    const ext = getExtFromMime(file.mimetype);
    const key = `servers/${serverId}/sub-servers/${subServerId}/gallery/${mediaId}.${ext}`;
    const url = await uploadToS3(key, file.buffer, file.mimetype);

    const media = await subServerService.addSubServerMedia(subServerId, mediaId, url);
    response.status(201).json(media);
  }

  /** 刪除一張媒體展示區圖片（需 MANAGE_SERVER 權限） */
  public async deleteSubServerMedia(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const subServerId = request.params.subServerId as string;
    const mediaId = request.params.mediaId as string;

    const subServer = await subServerService.getSubServerById(subServerId);
    if (!subServer || subServer.server_id !== serverId) {
      response.status(404).json({ message: "找不到該子伺服器" });
      return;
    }

    const media = await subServerService.getSubServerMediaById(mediaId);
    if (!media || media.sub_server_id !== subServerId) {
      response.status(404).json({ message: "找不到該圖片" });
      return;
    }

    const key = keyFromUrl(media.url);
    if (key) await deleteFromS3(key);
    await subServerService.deleteSubServerMedia(mediaId);
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
    const { name, description, tags, icon_url, host, port, sync_mode, position } = request.body;

    const resolvedName = (name ?? fallback?.name)?.toString().trim();
    // host 可選：新增時可只填名稱，缺省為空字串，之後在連線設定補
    const resolvedHost = (host ?? fallback?.host)?.toString().trim() ?? "";
    if (!resolvedName) {
      response.status(400).json({ message: "name 為必填" });
      return null;
    }

    const resolvedSyncMode: SyncMode = sync_mode ?? fallback?.sync_mode ?? "strict";
    if (!VALID_SYNC_MODES.includes(resolvedSyncMode)) {
      response.status(400).json({ message: "sync_mode 僅接受 'strict' 或 'additive'" });
      return null;
    }

    return {
      name: resolvedName,
      description: description ?? fallback?.description ?? null,
      tags: Array.isArray(tags) ? tags : (fallback?.tags ?? []),
      icon_url: icon_url ?? fallback?.icon_url ?? null,
      host: resolvedHost,
      port: Number(port ?? fallback?.port ?? 25565),
      sync_mode: resolvedSyncMode,
      position: Number(position ?? fallback?.position ?? 0),
    };
  }
}
