/**
 * @file environment.ts
 * @description 依據 NODE_ENV 合併 common 與對應環境的設定物件並匯出
 * @dependencies environment.common, environment.dev, environment.prod
 */
import { environment as commonEnv } from "./environment.common";
import { environment as prodEnv } from "./environment.prod";
import { environment as devEnv } from "./environment.dev";

const ENV = process.env.NODE_ENV || "development";

let env;

switch (ENV) {
    case "production":
        env = prodEnv;
        break;
    case "development":
        env = devEnv;
        break;
    default:
        throw new Error(`no matching constants file found for env '${env}'`);
}

export const environment = Object.assign(commonEnv, env);
