/**
 * @file index.ts
 * @description 應用程式進入點，載入環境變數並啟動 Express 伺服器
 * @dependencies app, environment
 */
import "dotenv/config";
import App from "./app";
import { environment } from "./environment/environment";

function main(): void {
    new App().listen(environment.port);
}

main();
