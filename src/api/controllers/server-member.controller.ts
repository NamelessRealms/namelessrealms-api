/**
 * @file server-member.controller.ts
 * @description 處理伺服器成員管理的 HTTP 請求（Discord 風格 role_id 架構）
 * @methods
 *   - getMembers: 取得伺服器所有成員列表（含角色資訊）
 *   - addMember: 用 username 邀請成員並指定角色 id
 *   - updateMemberRole: 修改指定成員角色
 *   - removeMember: 移除指定成員
 * @notes
 *   - Owner（servers.owner_user_id）不可被移除或修改角色
 *   - 不能邀請自己、不能操作自己
 */
import { Request, Response } from "express";
import ServerMemberService from "../services/server/server-member.service";
import ServerRoleService from "../services/server/server-role.service";
import ServerService from "../services/server/server.service";
import { AppError } from "../utils/response/AppError";

const memberService = new ServerMemberService();
const roleService = new ServerRoleService();
const serverService = new ServerService();

export default class ServerMemberController {
  /** 取得伺服器成員列表（需 MANAGE_MEMBERS 或 owner） */
  public async getMembers(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const members = await memberService.getMembers(serverId);
    response.json(members);
  }

  /** 用 username 邀請成員並指定角色（需 MANAGE_MEMBERS） */
  public async addMember(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const { username, role_id } = request.body;
    const callerId: string = (request as any).user?.sub ?? "";

    if (!username?.trim()) {
      response.status(400).json({ message: "username 為必填" });
      return;
    }
    if (!role_id) {
      response.status(400).json({ message: "role_id 為必填" });
      return;
    }

    // 確認角色屬於此伺服器
    const role = await roleService.getRoleById(role_id);
    if (!role || role.server_id !== serverId) {
      response.status(404).json({ message: "找不到該角色" });
      return;
    }

    const targetUserId = await memberService.getUserIdByUsername(username.trim());
    if (targetUserId === null) {
      response.status(404).json({ message: "找不到該使用者" });
      return;
    }
    if (targetUserId === callerId) {
      response.status(400).json({ message: "不能邀請自己" });
      return;
    }

    const userId = await memberService.addMemberByUsername(serverId, username.trim(), role_id);
    if (userId === null) {
      response.status(404).json({ message: "找不到該使用者" });
      return;
    }

    response.status(201).json({ user_id: userId, role_id });
  }

  /** 修改指定成員角色（需 MANAGE_MEMBERS） */
  public async updateMemberRole(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const targetUserId = request.params.uid as string;
    const { role_id } = request.body;
    const callerId: string = (request as any).user?.sub ?? "";

    if (!role_id) {
      response.status(400).json({ message: "role_id 為必填" });
      return;
    }

    // 確認角色屬於此伺服器
    const role = await roleService.getRoleById(role_id);
    if (!role || role.server_id !== serverId) {
      response.status(404).json({ message: "找不到該角色" });
      return;
    }

    const server = await serverService.getServerById(serverId);
    if (!server) throw new AppError("找不到伺服器", 404);

    if (targetUserId === server.owner_user_id) {
      throw new AppError("owner 不可被修改角色，請先轉讓擁有權", 403);
    }
    if (targetUserId === callerId) {
      throw new AppError("不能修改自己的角色", 403);
    }

    const target = await memberService.getMemberWithRole(serverId, targetUserId);
    if (!target) {
      response.status(404).json({ message: "找不到該成員" });
      return;
    }

    await memberService.updateMemberRole(serverId, targetUserId, role_id);
    response.json({ user_id: targetUserId, role_id });
  }

  /** 移除指定成員（需 MANAGE_MEMBERS） */
  public async removeMember(request: Request, response: Response): Promise<void> {
    const serverId = request.params.serverId as string;
    const targetUserId = request.params.uid as string;
    const callerId: string = (request as any).user?.sub ?? "";

    const server = await serverService.getServerById(serverId);
    if (!server) throw new AppError("找不到伺服器", 404);

    if (targetUserId === server.owner_user_id) {
      throw new AppError("owner 不可被移除，請先轉讓擁有權", 403);
    }
    if (targetUserId === callerId) {
      throw new AppError("不能移除自己", 403);
    }

    const target = await memberService.getMemberWithRole(serverId, targetUserId);
    if (!target) {
      response.status(404).json({ message: "找不到該成員" });
      return;
    }

    await memberService.removeMember(serverId, targetUserId);
    response.status(204).send();
  }
}
