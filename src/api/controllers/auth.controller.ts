/**
 * @file auth.controller.ts
 * @description 處理認證相關 HTTP 請求，包含 OAuth2 登入、Token 刷新、驗證碼發送與用戶註冊
 * @methods
 *   - login: OAuth2 密碼授權與 Refresh Token 流程
 *   - validateSession: 驗證當前 JWT 是否有效
 *   - sendCode: 向指定信箱發送 6 位數驗證碼
 *   - register: 以驗證碼完成新用戶註冊
 *   - logout: 撤銷 Refresh Token（登出本裝置）
 * @dependencies AuthService, AppError, environment
 */
import { Request, Response } from "express";
import { environment } from "../../environment/environment";

import { IOAuth2 } from "../../interface/auth/IOAuth2";
import AuthService from "../services/auth/auth.service";
import { AppError } from "../utils/response/AppError";

export default class AuthController {
  private _authService = new AuthService();

  /**
   * @openapi
   * /oauth2/token:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: 用戶登入取得 Token
   *     description: 支援 OAuth 2.0 Password Grant 流程。驗證成功後將回傳 Access Token 與用戶基本資訊。
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - grant_type
   *               - username
   *               - password
   *             properties:
   *               grant_type:
   *                 type: string
   *                 example: password
   *                 description: 授權類型，固定為 password
   *               username:
   *                 type: string
   *                 example: quasi
   *                 description: 帳號
   *               password:
   *                 type: string
   *                 example: "123456"
   *                 description: 密碼
   *     responses:
   *       200:
   *         description: 登入成功
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 access_token:
   *                   type: string
   *                 token_type:
   *                   type: string
   *                   example: bearer
   *                 expires_in:
   *                   type: number
   *                 scope:
   *                   type: array
   *                   items:
   *                     type: string
   *                 info:
   *                   type: object
   *                   properties:
   *                     username:
   *                       type: string
   *       400:
   *         description: 參數錯誤或驗證失敗
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: string
   *                   example: 通訊協定錯誤，遺漏必要的參數。
   *       401:
   *         description: 認證失敗
   */
  public async login(request: Request, response: Response) {
    const bodyData: IOAuth2 = request.body;

    if (!bodyData.grant_type) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400, "InvalidRequest");
    }

    // 確保客戶端不會緩存此請求
    response.header("Cache-Control", "no-store");
    response.header("Pragma", "no-cache");

    if (bodyData.grant_type === "refresh_token") {
      if (!bodyData.refresh_token) {
        throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400, "InvalidRequest");
      }
      const refreshData = await this._authService.refreshAccessToken(bodyData.refresh_token);
      return response.status(200).json({
        access_token: refreshData.accessToken,
        token_type: "bearer",
        // ⚠️ 絕對 epoch 毫秒，⛔ 不是 OAuth2 的「剩餘秒數」。與 Nymless `is_token_expired()` 的解讀對齊，
        //    ⛔ 不得單邊改成秒數（改了會讓客戶端把小整數當 1970 年時間戳，或把時間戳當秒數而永不過期）。
        expires_in: new Date().getTime() + environment.jwt.increaseTime,
        scope: refreshData.role,
        refresh_token: refreshData.refreshToken,
        info: { username: refreshData.username },
      });
    }

    if (bodyData.grant_type === "password") {
      if (!this._verifyRequest(bodyData)) {
        throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400, "InvalidRequest");
      }
      const verifyData = await this._authService.verify(bodyData);
      return response.status(200).json({
        access_token: verifyData.tokenCode,
        token_type: "bearer",
        // ⚠️ 絕對 epoch 毫秒，⛔ 不是 OAuth2 的「剩餘秒數」（語意說明同上）
        expires_in: new Date().getTime() + environment.jwt.increaseTime,
        scope: verifyData.role,
        refresh_token: verifyData.refreshToken,
        info: { username: verifyData.username },
      });
    }

    throw new AppError("登入方式不支援，請重新操作。", 400, "InvalidRequest");
  }

  public async validateSession(_request: Request, response: Response) {
    return response.status(200).json({ success: true });
  }

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: 登出並撤銷 Refresh Token
   *     description: >
   *       將指定的 Refresh Token 加入撤銷清單，使其無法再換發 Access Token。
   *       撤銷以 token 雜湊為鍵，只影響持有該 token 的裝置，不影響同帳號的其他裝置。
   *       ⛔ 本端點不掛 authJwtVerify——持有 Refresh Token 本身即為憑證，
   *       且 Access Token 可能已過期，那正是需要登出的情境之一。
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - refresh_token
   *             properties:
   *               refresh_token:
   *                 type: string
   *     responses:
   *       200:
   *         description: 已登出
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: 遺漏 refresh_token
   *       401:
   *         description: Refresh Token 無效或已過期
   */
  public async logout(request: Request, response: Response) {
    const { refresh_token } = request.body;

    if (!refresh_token) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400, "InvalidRequest");
    }

    await this._authService.revokeRefreshToken(refresh_token);

    return response.status(200).json({ success: true });
  }

  private _verifyRequest(requestBody: any): boolean {
    if (!requestBody.hasOwnProperty("grant_type")) {
      return false;
    }

    if (!requestBody.hasOwnProperty("username")) {
      return false;
    }

    if (!requestBody.hasOwnProperty("password")) {
      return false;
    }

    return true;
  }

  /**
   * @openapi
   * /auth/register:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: 註冊新用戶
   *     description: 建立新的平台帳號。
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - username
   *               - email
   *               - password
   *             properties:
   *               username:
   *                 type: string
   *                 example: newuser
   *               email:
   *                 type: string
   *                 example: user@example.com
   *               password:
   *                 type: string
   *                 example: "password123"
   *     responses:
   *       201:
   *         description: 註冊成功
   *       400:
   *         description: 參數錯誤
   *       409:
   *         description: 使用者已存在
   */
  /**
   * @openapi
   * /auth/send-code:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: 發送註冊驗證碼
   *     description: 向指定的 Email 發送 6 位數驗證碼。
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - email
   *             properties:
   *               email:
   *                 type: string
   *                 example: user@example.com
   *     responses:
   *       200:
   *         description: 驗證碼已發送
   *       400:
   *         description: Email 格式不正確
   */
  public async sendCode(request: Request, response: Response) {
    const { email } = request.body;

    if (!email) {
      throw new AppError("請提供 Email。", 400, "InvalidRequest");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError("Email 格式不正確。", 400, "InvalidRequest");
    }

    await this._authService.generateAndSaveCode(email);

    return response.status(200).json({
      success: true,
      message: "驗證碼已發送到您的信箱。",
    });
  }

  /**
   * @openapi
   * /auth/register:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: 註冊新用戶
   *     description: 建立新的平台帳號，需提供信箱驗證碼。
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - username
   *               - email
   *               - password
   *               - code
   *             properties:
   *               username:
   *                 type: string
   *               email:
   *                 type: string
   *               password:
   *                 type: string
   *               code:
   *                 type: string
   *                 example: "123456"
   *     responses:
   *       201:
   *         description: 註冊成功
   *       400:
   *         description: 參數錯誤或驗證碼不正確
   *       409:
   *         description: 使用者已存在
   */
  public async register(request: Request, response: Response) {
    const { username, email, password, code } = request.body;

    // 1. 基本驗證
    if (!username || !email || !password || !code) {
      throw new AppError("遺漏必要的註冊參數或驗證碼。", 400, "InvalidRequest");
    }

    // 簡單的 Email 格式驗證
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError("Email 格式不正確。", 400, "InvalidRequest");
    }

    // 密碼長度驗證
    if (password.length < 6) {
      throw new AppError("密碼長度必須至少為 6 個字元。", 400, "InvalidRequest");
    }

    try {
      // 2. 呼叫 Service 執行註冊
      const verifyData = await this._authService.registerUser({ username, email, password }, code);

      // 3. 回傳成功（欄位與 login() 對稱，讓客戶端能沿用同一條 session 持久化路徑；
      //    既有的 success / message 保留，舊客戶端不受影響）
      return response.status(201).json({
        success: true,
        message: "註冊成功！",
        access_token: verifyData.accessToken,
        token_type: "bearer",
        // ⚠️ 絕對 epoch 毫秒，⛔ 不是 OAuth2 的「剩餘秒數」（語意說明同 login()）
        expires_in: new Date().getTime() + environment.jwt.increaseTime,
        scope: verifyData.role,
        refresh_token: verifyData.refreshToken,
        info: { username: verifyData.username },
      });

    } catch (error: any) {
      // 如果 Service 拋出 409，則傳遞給全域錯誤處理器或在此處理
      if (error.status === 409) {
        return response.status(409).json({
          success: false,
          code: "Conflict",
          error: error.message,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
