/**
 * @file AppError.ts
 * @description 可操作性錯誤類別，攜帶 HTTP 狀態碼與業務錯誤代碼，供全域 errorMiddleware 格式化回應
 * @notes isOperational = true 表示預期內的業務錯誤；false 則代表程式 bug
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code = "UnknownError",
    isOperational = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}
