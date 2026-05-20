/**
 * @file requirePermission.ts
 * @description 基於 bitmask 的伺服器權限檢查 middleware factory
 * @methods requirePermission - 回傳一個 Express middleware，驗證呼叫者是否持有指定權限旗標
 * @notes Owner（servers.owner_user_id）永遠繞過權限檢查；通過後 req.serverMember 可供下游使用
 */
import { Request, Response, NextFunction } from "express";
import { asyncHandler } from "./asyncHandler";
import { AppError } from "../utils/response/AppError";
import { hasPermission } from "../utils/permissions";
import ServerService from "../services/server/server.service";
import ServerMemberService from "../services/server/server-member.service";

const serverService = new ServerService();
const serverMemberService = new ServerMemberService();

/**
 * 建立要求呼叫者在目標伺服器擁有指定 permission bitmask 的 middleware。
 * @param permission 所需的權限旗標（Permission 常數）
 */
export function requirePermission(permission: number) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    const userId: string = (req as any).user?.sub;
    const serverId = req.params.serverId as string;

    if (!userId || !serverId) {
      throw new AppError("無法識別使用者或伺服器", 400);
    }

    const server = await serverService.getServerById(serverId);
    if (!server) throw new AppError("找不到伺服器", 404);

    // Owner 永遠放行
    if (server.owner_user_id === userId) return next();

    const member = await serverMemberService.getMemberWithRole(serverId, userId);
    if (!member || !hasPermission(member.role.permissions, permission)) {
      throw new AppError("無權限", 403);
    }

    (req as any).serverMember = member;
    next();
  });
}
