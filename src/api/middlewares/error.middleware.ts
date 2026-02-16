import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/response/AppError";
import Logs from "../utils/logs";

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      isOperational: err.isOperational,
    });
  }

  // 非預期的錯誤（例如程式 bug）
  Logs.error(`[Unhandled Error] ${err.stack || err}`);

  return res.status(500).json({
    success: false,
    error: "伺服器發生非預期的錯誤。",
  });
};
