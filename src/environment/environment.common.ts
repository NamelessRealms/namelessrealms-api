/**
 * @file environment.common.ts
 * @description 所有環境共用的設定值，包含 API 版本與 JWT 過期時間
 * @dependencies version
 */
import { API_VERSION } from "../version";

export const environment = {
    api_version: API_VERSION,
    jwt: {
        increaseTime: 600000
    }
}
