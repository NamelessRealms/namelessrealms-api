/**
 * @file verifyApiKey.ts
 * @description API Key 驗證中介層，支援純 API Key 驗證或 API Key / JWT 二擇一的彈性驗證
 * @methods
 *   - verify: 僅接受 x-api-key header 的請求
 *   - verifyOrJwt: 優先驗證 JWT，若無 JWT 則回退至 API Key 驗證
 * @dependencies mysql2, jsonwebtoken, AppError, config.service
 * @notes JWT 存在但無效時不會回退至 API Key，以避免安全歧義
 */
import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/response/AppError";
import Mysql from "../utils/mysql";
import { RowDataPacket } from "mysql2";
import * as jwt from "jsonwebtoken";
import { config } from "../../config/config.service";

interface IDecoded {
  _id: string;
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  role: string;
}

export class VerifyApiKey {
  public async verify(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    try {
      const apiKey = request.headers["x-api-key"] as string;

      if (!apiKey) {
        throw new AppError("沒有 API Key。", 401);
      }

      const pool = Mysql.getPool();
      const [rows] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM `api_keys` WHERE `key` = ? AND `isActive` = 1",
        [apiKey],
      );

      if (rows.length === 0) {
        throw new AppError("無效的 API Key。", 401);
      }

      const appData = rows[0];
      request.appContext = {
        appName: appData.appName,
        permissions: appData.permissions, // Assuming JSON column is auto-parsed by mysql2 or needs parsing
      };

      return next();
    } catch (error) {
      next(error);
    }
  }

  public async verifyOrJwt(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    try {
      const apiKey = request.headers["x-api-key"] as string;
      const token = request.headers.authorization as string;

      if (token) {
        try {
          // Remove 'Bearer ' if present
          const actualToken = token.startsWith("Bearer ")
            ? token.slice(7)
            : token;
          const decoded = jwt.verify(
            actualToken,
            config.jwt.secret,
          ) as IDecoded;
          request.user = decoded;
          return next();
        } catch (error: any) {
          // If token is provided but invalid, we don't fall back to API Key to avoid security ambiguity
          // UNLESS the user explicitly wants to try both.
          // For now, if token is present, we treat it as the primary auth method.
          if (error.name === "TokenExpiredError")
            throw new AppError("Token 過期。", 401);
          if (error.name === "JsonWebTokenError")
            throw new AppError("Token 無效。", 401);
          throw error;
        }
      }

      if (apiKey) {
        const pool = Mysql.getPool();
        const [rows] = await pool.query<RowDataPacket[]>(
          "SELECT * FROM `api_keys` WHERE `key` = ? AND `isActive` = 1",
          [apiKey],
        );

        if (rows.length === 0) {
          throw new AppError("無效的 API Key。", 401);
        }

        const appData = rows[0];
        request.appContext = {
          appName: appData.appName,
          permissions: appData.permissions,
        };

        return next();
      }

      throw new AppError("未提供認證資訊 (JWT 或 API Key)。", 401);
    } catch (error) {
      next(error);
    }
  }
}
