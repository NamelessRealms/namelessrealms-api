/**
 * @file asyncHandler.ts
 * @description 將非同步 Express route handler 包裹並自動捕捉 Promise rejection，轉交給 next()
 * @methods asyncHandler - 包裹非同步 handler，避免未捕捉的 Promise 錯誤
 * @dependencies express
 */
import { Request, Response, NextFunction } from "express";

export const asyncHandler =
  (fn: any) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
