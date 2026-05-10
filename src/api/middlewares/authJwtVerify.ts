import { Request, Response, NextFunction } from "express";

import * as jwt from "jsonwebtoken";
import { AppError } from "../utils/response/AppError";
import { config } from "../../config/config.service";
import * as socketIo from "socket.io";
import { ExtendedError } from "socket.io/dist/namespace";

interface IDecoded {
  _id: string;
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  role: string;
}

export default class AuthJwtVerify {
  public verifyToken(request: Request, response: Response, next: NextFunction) {
    try {
      const token = request.headers.authorization as string;

      // 沒有 token
      if (!token) {
        throw new AppError("沒有 Token。", 401);
      }

      request.user = jwt.verify(token, config.jwt.secret) as IDecoded;

      return next();
    } catch (error: any) {
      switch (error.name) {
        // JWT 過期
        case "TokenExpiredError":
          throw new AppError("Token 過期。", 401);
        // JWT 無效
        case "JsonWebTokenError":
          throw new AppError("Token 無效。", 401);
        default:
          throw error;
      }
    }
  }

  public socketVerifyToken(
    socket: socketIo.Socket,
    next: (err?: ExtendedError) => void,
  ) {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(
          new Error(
            JSON.stringify({
              code: 401,
              error: "invalid_client",
              error_description: "沒有 Token。",
            }),
          ),
        );
      }

      jwt.verify(token, config.jwt.secret);

      return next();
    } catch (error: any) {
      switch (error.name) {
        // JWT 過期
        case "TokenExpiredError":
          return next(
            new Error(
              JSON.stringify({
                code: 400,
                error: "invalid_grant",
                error_description: "Token 過期。",
              }),
            ),
          );
        // JWT 無效
        case "JsonWebTokenError":
          return next(
            new Error(
              JSON.stringify({
                code: 400,
                error: "invalid_grant",
                error_description: "Token 無效。",
              }),
            ),
          );
      }
    }
  }

  public accessControl(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    // 如不是 admin，則無權限
    if (!request.user) {
      throw new AppError("無權限。", 403);
    }

    switch (request.user.role) {
      case null:
      case "user":
      case "guest":
        throw new AppError("無權限。", 403);
    }

    return next();
  }
}
