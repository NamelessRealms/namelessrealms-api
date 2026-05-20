/**
 * @file server-role.controller.ts
 * @description 處理伺服器自訂角色 CRUD 與排序的 HTTP 請求
 * @methods
 *   - getRoles: 列出伺服器所有角色（公開）
 *   - createRole: 建立新角色（需 MANAGE_ROLES）
 *   - updateRole: 更新角色（需 MANAGE_ROLES）
 *   - deleteRole: 刪除角色（需 MANAGE_ROLES）
 *   - reorderRoles: 批次更新角色排序（需 MANAGE_ROLES）
 * @notes
 *   - 不能刪除仍有成員持有的角色（→ 409）
 *   - 非 owner 不能給角色設定比自己更高的 permission
 */
import { Request, Response } from "express";
import ServerRoleService from "../services/server/server-role.service";
import ServerService from "../services/server/server.service";
import { AppError } from "../utils/response/AppError";
import { hasPermission, Permission } from "../utils/permissions";

const roleService = new ServerRoleService();
const serverService = new ServerService();

export default class ServerRoleController {
  /** 取得伺服器所有角色列表（公開，不需認證） */
  public async getRoles(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const roles = await roleService.getRoles(serverId);
    response.json(roles);
  }

  /** 建立新角色（需 MANAGE_ROLES 權限） */
  public async createRole(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const { name, color = "#99aab5", permissions = 0 } = request.body;

    if (!name?.trim()) {
      response.status(400).json({ message: "角色名稱為必填" });
      return;
    }

    await this._guardPermissionEscalation(request, serverId, permissions);

    const result = await roleService.createRole(serverId, name.trim(), color, permissions);
    response.status(201).json(result);
  }

  /** 更新角色名稱、顏色、權限（需 MANAGE_ROLES 權限） */
  public async updateRole(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const roleId = request.params.roleId as string;
    const { name, color, permissions } = request.body;

    const role = await roleService.getRoleById(roleId);
    if (!role || role.server_id !== serverId) {
      response.status(404).json({ message: "找不到該角色" });
      return;
    }

    if (permissions !== undefined) {
      await this._guardPermissionEscalation(request, serverId, permissions);
    }

    await roleService.updateRole(
      roleId,
      name ?? role.name,
      color ?? role.color,
      permissions ?? role.permissions
    );
    response.json({ id: roleId });
  }

  /** 刪除角色（需 MANAGE_ROLES 權限；若有成員持有則 409） */
  public async deleteRole(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const roleId = request.params.roleId as string;

    const role = await roleService.getRoleById(roleId);
    if (!role || role.server_id !== serverId) {
      response.status(404).json({ message: "找不到該角色" });
      return;
    }

    // deleteRole 內部會在有成員持有時拋出 409 AppError
    await roleService.deleteRole(roleId);
    response.status(204).send();
  }

  /** 批次更新角色排序（需 MANAGE_ROLES 權限） */
  public async reorderRoles(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const { orderedIds } = request.body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      response.status(400).json({ message: "orderedIds 為必填陣列" });
      return;
    }

    await roleService.reorderRoles(serverId, orderedIds);
    response.json({ ok: true });
  }

  /**
   * 確保非 owner 的呼叫者不能給角色設定比自己更高的 permission。
   * Owner 永遠略過此檢查（已在 middleware 中處理）。
   */
  private async _guardPermissionEscalation(
    request: Request,
    serverId: string,
    targetPermissions: number
  ): Promise<void> {
    const userId: string = (request as any).user?.sub;
    const server = await serverService.getServerById(serverId);
    if (!server) throw new AppError("找不到伺服器", 404);
    if (server.owner_user_id === userId) return;

    const member = (request as any).serverMember;
    const callerPerms: number = member?.role?.permissions ?? 0;

    // 若目標 permissions 包含呼叫者自己沒有的旗標，拒絕
    const extraPerms = targetPermissions & ~callerPerms;
    if (extraPerms !== 0 && !hasPermission(callerPerms, Permission.ADMINISTRATOR)) {
      throw new AppError("不能給予比自己更高的權限", 403);
    }
  }
}
