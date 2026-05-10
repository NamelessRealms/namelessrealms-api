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
