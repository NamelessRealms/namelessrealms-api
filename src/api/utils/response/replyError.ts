/**
 * @file replyError.ts
 * @description 舊式錯誤回應工具（已被 errorMiddleware + AppError 取代，保留供向下相容）
 * @methods
 *   - replyServerError: 回傳 500 伺服器錯誤
 *   - replyParameterError: 回傳 400 參數錯誤
 * @dependencies express
 */
import { Response } from "express";

export default class ReplyError {

    public static replyServerError(response: Response): void {
        response.status(500).json({
            error: "server_error",
            error_description: "伺服器發生非預期的錯誤。"
        });
    }

    public static replyParameterError(response: Response): void {
        response.status(400).json({
            error: "invalid_request",
            error_description: "通訊協定錯誤，遺漏必要的參數或者參數格式錯誤。"
        });
    }

}
