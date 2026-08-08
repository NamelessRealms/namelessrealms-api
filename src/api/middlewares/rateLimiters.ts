/**
 * @file rateLimiters.ts
 * @description 定義各端點的速率限制器，防止暴力攻擊
 * @methods
 *   - loginLimiter: 登入端點，15 分鐘內最多 10 次
 *   - sendCodeLimiter: 驗證碼發送端點，10 分鐘內最多 3 次
 *   - logoutLimiter: 登出端點，15 分鐘內最多 30 次
 * @dependencies express-rate-limit
 */
import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    code: "TooManyRequests",
    error: "請求次數過多，請稍後再試。",
  },
});

export const sendCodeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    code: "TooManyRequests",
    error: "驗證碼發送次數過多，請 10 分鐘後再試。",
  },
});

// 登出是使用者主動且低頻的動作，⛔ 不套 loginLimiter（語意不同，且會讓「登出→重登→再登出」撞牆）。
// 30 次足以吸收正常重試；濫用面有限——寫入撤銷表需先通過 jwt.verify，攻擊者持有有效 token 時登出他自己並無收益。
export const logoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    code: "TooManyRequests",
    error: "請求次數過多，請稍後再試。",
  },
});
