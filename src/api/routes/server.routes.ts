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
import ServerSubServerController from "../controllers/server-sub-server.controller";
import * as modpackController from "../controllers/server-modpack.controller";
import IRoutes from "./IRoutes";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requirePermission } from "../middlewares/requirePermission";
import { Permission } from "../utils/permissions";

const upload = multer({ storage: multer.memoryStorage() });

export default class ServerRouter extends IRoutes {
  private _serverController = new ServerController();
  private _roleController = new ServerRoleController();
  private _memberController = new ServerMemberController();
  private _subServerController = new ServerSubServerController();

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

    // 取得呼叫者於該伺服器的有效權限（owner 回 ADMINISTRATOR）
    this._routers
      .route("/:serverId/me")
      .get(
        this._authJwtVerify.verifyToken,
        asyncHandler((req: Request, res: Response) =>
          this._serverController.getMyMembership(req, res)
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
      )
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._serverController.deleteServerMedia(req, res, "icon")
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
      )
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._serverController.deleteServerMedia(req, res, "background")
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

    // --- 子伺服器管理路由 ---

    this._routers
      .route("/:serverId/sub-servers")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.getSubServers(req, res)
        )
      )
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.createSubServer(req, res)
        )
      );

    // 子伺服器目前啟用的 modpack 版本（供啟動流程取 manifest）
    this._routers
      .route("/:serverId/sub-servers/:subServerId/active-modpack")
      .get(
        asyncHandler((req: Request, res: Response) =>
          modpackController.getActiveModpackForSubServer(req, res)
        )
      );

    // 子伺服器媒體展示區（gallery）：列出（公開）／上傳（需 MANAGE_SERVER）
    this._routers
      .route("/:serverId/sub-servers/:subServerId/media")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.getSubServerMedia(req, res)
        )
      )
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.uploadSubServerMedia(req, res)
        )
      );

    this._routers
      .route("/:serverId/sub-servers/:subServerId/media/:mediaId")
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.deleteSubServerMedia(req, res)
        )
      );

    this._routers
      .route("/:serverId/sub-servers/:subServerId")
      .get(
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.getSubServer(req, res)
        )
      )
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.updateSubServer(req, res)
        )
      )
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          this._subServerController.deleteSubServer(req, res)
        )
      );

    // --- 模組包版本管理路由 ---

    // 注意：import 路由必須在 /:versionId 之前，避免被誤解析成 versionId
    this._routers
      .route("/:serverId/modpack-versions/import")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) =>
          modpackController.importVersion(req, res)
        )
      );

    this._routers
      .route("/:serverId/modpack-versions")
      .get(asyncHandler((req: Request, res: Response) => modpackController.getVersions(req, res)))
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.createVersion(req, res))
      );

    this._routers
      .route("/:serverId/modpack-versions/:versionId/activate")
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.activateVersion(req, res))
      );

    this._routers
      .route("/:serverId/modpack-versions/:versionId/publish")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.publishVersion(req, res))
      );

    this._routers
      .route("/:serverId/modpack-versions/:versionId/derive")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.deriveVersion(req, res))
      );

    // 注意：files/restore 必須在 files/:fileId 之前，避免 "restore" 被誤解析成 fileId
    this._routers
      .route("/:serverId/modpack-versions/:versionId/files/restore")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.restoreFile(req, res))
      );

    this._routers
      .route("/:serverId/modpack-versions/:versionId/files")
      .get(asyncHandler((req: Request, res: Response) => modpackController.getFiles(req, res)))
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        upload.single("file") as any,
        asyncHandler((req: Request, res: Response) => modpackController.addFile(req, res))
      );

    // 注意：files/from-platform 必須在 files/:fileId 之前，避免 "from-platform" 被誤解析成 fileId
    this._routers
      .route("/:serverId/modpack-versions/:versionId/files/from-platform")
      .post(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) =>
          modpackController.addFileFromPlatform(req, res)
        )
      );

    this._routers
      .route("/:serverId/modpack-versions/:versionId/files/:fileId")
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.updateFilePolicy(req, res))
      )
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.removeFile(req, res))
      );

    this._routers
      .route("/:serverId/modpack-versions/:versionId")
      .patch(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.updateVersion(req, res))
      )
      .delete(
        this._authJwtVerify.verifyToken,
        requirePermission(Permission.MANAGE_SERVER),
        asyncHandler((req: Request, res: Response) => modpackController.deleteVersion(req, res))
      );
  }
}
