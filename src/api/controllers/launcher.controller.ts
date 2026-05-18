/**
 * @file launcher.controller.ts
 * @description 處理 Launcher 相關資源的 HTTP 請求，包含資產設定、頁面設定、自動更新與 Discord Webhook 轉發
 * @methods
 *   - getLauncherAssets / getLauncherAssetsV2: 取得 Launcher 資產設定（V1 / V2）
 *   - getLauncherPage: 取得 Launcher 頁面設定
 *   - putLauncherAssets / putLauncherAssetsV2 / putLauncherPage: 更新對應設定
 *   - getAutoUpdaterLatest / getAutoUpdaterLatestNupkg: 重導向至 GitHub 最新 Release 檔案
 *   - postDiscordWebhooks: 轉發 multipart 內容至 Discord Webhook
 * @dependencies LauncherService, form-data, config.service, AppError
 */
import { Request, Response } from "express";
import FormData from "form-data";
import { config } from "../../config/config.service";

import LauncherService from "../services/launcher/launcher.service";
import { AppError } from "../utils/response/AppError";

export default class LauncherController {
  private _launcherService = new LauncherService();

  /**
   * @openapi
   * /launcher/assets:
   *   get:
   *     tags:
   *       - Launcher
   *     summary: 取得 Launcher 資產設定 (V1)
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getLauncherAssets(
    request: Request,
    response: Response,
  ): Promise<void> {
    const launcherAssetsData = await this._launcherService.getLauncherAssets();

    response.status(200).json(launcherAssetsData);
  }

  /**
   * @openapi
   * /launcher/v2/assets:
   *   get:
   *     tags:
   *       - Launcher
   *     summary: 取得 Launcher 資產設定 (V2)
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getLauncherAssetsV2(
    request: Request,
    response: Response,
  ): Promise<void> {
    const launcherAssetsV2Data =
      await this._launcherService.getLauncherAssetsV2();

    response.status(200).json(launcherAssetsV2Data);
  }

  /**
   * @openapi
   * /launcher/page:
   *   get:
   *     tags:
   *       - Launcher
   *     summary: 取得 Launcher 頁面設定
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: 成功
   */
  public async getLauncherPage(
    request: Request,
    response: Response,
  ): Promise<void> {
    const launcherPageData = await this._launcherService.getLauncherPage();

    response.status(200).json(launcherPageData);
  }

  /**
   * @openapi
   * /launcher/page:
   *   put:
   *     tags:
   *       - Launcher
   *     summary: 修改 Launcher 頁面設定
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       201:
   *         description: 修改成功
   */
  public async putLauncherAssets(
    request: Request,
    response: Response,
  ): Promise<void> {
    const launcherAssetsBody = request.body;
    const putLauncherAssets = await this._launcherService.putLauncherAssets(
      JSON.stringify(launcherAssetsBody),
    );

    if (putLauncherAssets.modified) {
      response.status(201).json({
        message: "success",
        info: launcherAssetsBody,
      });
    } else {
      response.status(304).send();
    }
  }

  public async putLauncherAssetsV2(
    request: Request,
    response: Response,
  ): Promise<void> {
    const launcherAssetsBody = request.body;
    const putLauncherAssets =
      await this._launcherService.updateLauncherAssetsV2(
        JSON.stringify(launcherAssetsBody),
      );

    if (putLauncherAssets.modified) {
      response.status(201).json({
        message: "success",
        info: launcherAssetsBody,
      });
    } else {
      response.status(304).send();
    }
  }

  public async putLauncherPage(
    request: Request,
    response: Response,
  ): Promise<void> {
    const launcherPageBody = request.body;
    const putLauncherPage = await this._launcherService.putLauncherPage(
      JSON.stringify(launcherPageBody),
    );

    if (putLauncherPage.modified) {
      response.status(201).json({
        message: "success",
        info: launcherPageBody,
      });
    } else {
      response.status(304).send();
    }
  }

  public async getAutoUpdaterLatest(
    request: Request,
    response: Response,
  ): Promise<void> {
    try {
      // windows
      // TODO: not osx
      const githubReleasesLatest =
        await this._launcherService.getGithubReleasesLatest();

      const releaseData = await githubReleasesLatest.assets.find(
        (item: any) => item.name === "RELEASES",
      );
      response.redirect(releaseData.browser_download_url);
    } catch (error: any) {
      if (
        error.error === "get-api-statusCode-not-200" ||
        error.error === "github-api-offline"
      ) {
        throw new AppError(error.error_description || error.error, 400);
      }
      throw error;
    }
  }

  public async getAutoUpdaterLatestNupkg(
    request: Request,
    response: Response,
  ): Promise<void> {
    const fileName = request.params.fileName;
    const githubReleasesLatest =
      await this._launcherService.getGithubReleasesLatest();
    const nupkgData = await githubReleasesLatest.assets.find(
      (item: any) => item.name === fileName,
    );

    response.redirect(nupkgData.browser_download_url);
  }

  /**
   * @openapi
   * /launcher/v2/webhooks/discord:
   *   post:
   *     tags:
   *       - Launcher
   *     summary: 轉發至 Discord Webhook
   *     security:
   *       - bearerAuth: []
   *     description: 支援 multipart/form-data 格式，可上傳檔案與 payload_json。
   *     requestBody:
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             properties:
   *               payload_json:
   *                 type: string
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: 傳送成功
   */
  public async postDiscordWebhooks(
    request: Request,
    response: Response,
  ): Promise<void> {
    const webhooksErrorUrl = config.webhooksErrorUrl;

    if (!webhooksErrorUrl) {
      throw new Error("Env WEBHOOKS_ERROR_URL not null.");
    }

    const payloadJson = request.body.payload_json;
    const files = request.files as any[];

    const form = new FormData();

    if (files !== undefined && Array.isArray(files)) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        form.append(`file${i + 1}`, file.buffer, {
          filename: file.originalname,
        });
      }
    }

    form.append("payload_json", payloadJson);

    await new Promise<void>((resolve, reject) => {
      form.submit(webhooksErrorUrl, (error: any) => {
        if (error) {
          return reject(new AppError("webhooks send error", 404));
        }
        resolve();
      });
    });

    response.status(200).end();
  }
}
