/**
 * @file error.middleware.ts
 * @description 全域 Express 錯誤處理中介層，區分 AppError（可操作性錯誤）與未預期錯誤並回傳標準 JSON 格式
 * @methods errorMiddleware - 統一格式化並回應所有路由拋出的錯誤
 * @dependencies AppError, logger
 * @notes 必須掛載在所有路由之後才能捕捉路由錯誤
 */
import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/response/AppError";
import logger from "../utils/logger";

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      error: err.message,
      message: err.message,
      isOperational: err.isOperational,
    });
  }

  // 非預期的錯誤（例如程式 bug）
  logger.error(`[Unhandled Error] ${err.stack || err}`);

  return res.status(500).json({
    success: false,
    code: "UnknownError",
    error: "伺服器發生非預期的錯誤。",
    message: "伺服器發生非預期的錯誤。",
  });
};
