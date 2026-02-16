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

    // 確保客戶端必要的參數
    if (!this._verifyRequest(bodyData)) {
      throw new AppError("通訊協定錯誤，遺漏必要的參數。", 400);
    }

    const verifyData = await this._authService.verify(bodyData);

    // 確保客戶端不會緩存此請求
    response.header("Cache-Control", "no-store");
    response.header("Pragma", "no-cache");

    return response.status(200).json({
      access_token: verifyData.tokenCode,
      token_type: "bearer",
      expires_in: new Date().getTime() + environment.jwt.increaseTime,
      scope: verifyData.role,
      info: {
        username: verifyData.username,
      },
    });
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
}
