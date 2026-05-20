/**
 * @file server.routes.ts
 * @description 社群伺服器路由（前綴 /servers）：CRUD、圖片上傳、角色管理與成員管理端點
 * @dependencies ServerController, ServerRoleController, ServerMemberController, multer, requirePermission
 */
import multer from "multer";
import { Application, Request, Response } from "express";
import ServerController from "../controllers/server.controller";
import ServerRoleController from "../controllers/server-role.controller";
import ServerMemberController from "../controllers/server-member.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requirePermission } from "../middlewares/requirePermission";
import { Permission } from "../utils/permissions";

const upload = multer({ storage: multer.memoryStorage() });

export default class ServerRouter extends IRoutes {
  private _serverController = new ServerController();
  private _roleController = new ServerRoleController();
  private _memberController = new ServerMemberController();

  constructor(app: Application) {
    super(app, "/servers");
  }

  protected _loadRoutes(): void {
    // --- 伺服器 CRUD ---

    this._routers
      .route("/")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._serverController.getServers(req, res)
        )
      )
      .post(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.postServer(req, res)
        )
      );

    this._routers
      .route("/:serverId")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._serverController.getServer(req, res)
        )
      )
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._serverController.patchServer(req, res)
        )
      );

    this._routers
      .route("/:serverId/icon")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.uploadServerMedia(req, res, "icon")
        )
      );

    this._routers
      .route("/:serverId/background")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.uploadServerMedia(req, res, "background")
        )
      );

    // --- 角色管理路由 ---

    // 注意：reorder 路由必須在 /:roleId 路由之前，避免被當成 roleId
    this._routers
      .route("/:serverId/roles/reorder")
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_ROLES),
        asyncHandler((req: Request, res: Response) =>
          this._roleController.reorderRoles(req, res)
        )
      );

    this._routers
      .route("/:serverId/roles")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._roleController.getRoles(req, res)
        )
      )
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_ROLES),
        asyncHandler((req: Request, res: Response) =>
          this._roleController.createRole(req, res)
        )
      );

    this._routers
      .route("/:serverId/roles/:roleId")
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_ROLES),
        asyncHandler((req: Request, res: Response) =>
          this._roleController.updateRole(req, res)
        )
      )
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_ROLES),
        asyncHandler((req: Request, res: Response) =>
          this._roleController.deleteRole(req, res)
        )
      );

    // --- 成員管理路由 ---

    this._routers
      .route("/:serverId/members")
      .get(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_MEMBERS),
        asyncHandler((req: Request, res: Response) =>
          this._memberController.getMembers(req, res)
        )
      )
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_MEMBERS),
        asyncHandler((req: Request, res: Response) =>
          this._memberController.addMember(req, res)
        )
      );

    this._routers
      .route("/:serverId/members/:uid/role")
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_MEMBERS),
        asyncHandler((req: Request, res: Response) =>
          this._memberController.updateMemberRole(req, res)
        )
      );

    this._routers
      .route("/:serverId/members/:uid")
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_MEMBERS),
        asyncHandler((req: Request, res: Response) =>
          this._memberController.removeMember(req, res)
        )
      );
  }
}
