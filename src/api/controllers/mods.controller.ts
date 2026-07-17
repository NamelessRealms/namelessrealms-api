/**
 * @file mods.controller.ts
 * @description 處理 CurseForge Mod 資源查詢的 HTTP 請求
 * @methods
 *   - getMod: 取得單一 Mod 檔案資訊
 *   - getMods: 批量取得多個 Mod 資訊
 *   - getModFiles: 批量取得多個 Mod 檔案資訊
 * @dependencies ModsService, VerifyRequestParameter, AppError
 */
import { Request, Response } from "express";
import ModsService from "../services/mods/mods.service";
import { lookupModMetadata } from "../services/mods/mod-metadata.service";
import VerifyRequestParameter from "../utils/verify/verifyRequestParameter";
import { AppError } from "../utils/response/AppError";

/** lookup 端點的 hashes 上限（防大 IN 展開） */
const LOOKUP_MAX_HASHES = 500;

export default class ModsController {
  private _modsService = new ModsService();

  /**
  /**
   * @openapi
   * /mods/{projectId}/file/{fileId}:
   *   get:
   *     tags:
   *       - Mods
   *     summary: 取得單一 Mod 檔案資訊
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: projectId
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: fileId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getMod(request: Request, response: Response): Promise<void> {
    const projectId = request.params.projectId as string;
    const fileId = request.params.fileId as string;
    try {
      const mod = await this._modsService.getMod(projectId, fileId);
      response.status(200).json(mod);
    } catch (error: any) {
      if (error.error === "request_curseforge_error") {
        throw new AppError(error.error_description || error.error, 400);
      }
      throw error;
    }
  }

  /**
   * @openapi
   * /mods:
   *   post:
   *     tags:
   *       - Mods
   *     summary: 批量取得 Mods 資訊
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               modIds:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getMods(request: Request, response: Response): Promise<void> {
    const bodyData: { modIds: Array<string> } = request.body;
    // 確保客戶端必要的參數
    if (!VerifyRequestParameter.verify(bodyData, ["modIds"])) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400);
    }

    try {
      const modIds = bodyData.modIds;
      const modsData = await this._modsService.getMods(modIds);
      response.status(200).json(modsData);
    } catch (error: any) {
      if (error.error === "request_curseforge_error") {
        throw new AppError(error.error_description || error.error, 400);
      }
      throw error;
    }
  }

  /**
   * @openapi
   * /mods/files:
   *   post:
   *     tags:
   *       - Mods
   *     summary: 批量取得 Mod 檔案資訊
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               fileIds:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getModFiles(
    request: Request,
    response: Response,
  ): Promise<void> {
    const bodyData: { fileIds: Array<string> } = request.body;

    // 確保客戶端必要的參數
    if (!VerifyRequestParameter.verify(bodyData, ["fileIds"])) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400);
    }

    try {
      const fileIds = bodyData.fileIds;
      const modFilesData = await this._modsService.getModFiles(fileIds);
      response.status(200).json(modFilesData);
    } catch (error: any) {
      if (error.error === "request_curseforge_error") {
        throw new AppError(error.error_description || error.error, 400);
      }
      throw error;
    }
  }

  /**
   * @openapi
   * /mods/metadata/lookup:
   *   post:
   *     tags:
   *       - Mods
   *     summary: 批次查詢池物件（sha256）的 mod metadata（名稱 / icon）
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               hashes:
   *                 type: array
   *                 items:
   *                   type: string
   *     responses:
   *       200:
   *         description: 成功；回 { [sha256]: metadata }，只含有名稱者
   */
  public async lookupModMetadata(
    request: Request,
    response: Response,
  ): Promise<void> {
    const bodyData: { hashes: Array<string> } = request.body;
    if (!Array.isArray(bodyData?.hashes)) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400);
    }
    if (bodyData.hashes.length > LOOKUP_MAX_HASHES) {
      throw new AppError(`hashes 上限為 ${LOOKUP_MAX_HASHES} 筆。`, 400);
    }

    const result = await lookupModMetadata(bodyData.hashes);
    response.status(200).json(result);
  }
}
