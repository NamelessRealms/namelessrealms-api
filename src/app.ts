/**
 * @file app.ts
 * @description Express 應用程式核心類別，負責初始化中介層、路由、Socket.IO 及 HTTP 伺服器
 * @methods
 *   - constructor: 初始化 SSL、Express、中介層與路由
 *   - listen: 啟動 HTTP 伺服器並綁定 Socket.IO
 * @dependencies express, helmet, pino-http, cors, socket.io, swagger-ui-express
 * @notes 全域錯誤處理 errorMiddleware 必須放在所有路由之後
 */
import express from "express";
import path from "path";
import { config } from "./config/config.service";
import helmet from "helmet";
const cookieParser = require("cookie-parser");
import fs from "fs-extra";
import http from "http";
import https from "https";
const cors = require("cors");
import * as socketIo from "socket.io";
// import * as session from "express-session";

// route
import IndexRoutes from "./api/routes/index.routes";
import AuthRoutes from "./api/routes/auth.routes";
import WhitelistRoutes from "./api/routes/whitelist.routes";
import UserRouter from "./api/routes/user.routes";
import SponsorRouter from "./api/routes/sponsor.routes";
import ViolationRouter from "./api/routes/violation.routes";
import LauncherRouter from "./api/routes/launcher.routes";
import ServerRouter from "./api/routes/server.routes";
import ModsRoutes from "./api/routes/mods.routes";
import InteractionsRouter from "./api/routes/interactions.routes";
import LauncherV2Router from "./api/routes/launcherV2.routes";
import ModpacksRoutes from "./api/routes/modpacks.routes";

import Mysql from "./api/utils/mysql";
import logger from "./api/utils/logger";
import pinoHttp from "pino-http";

// environment
import { environment } from "./environment/environment";
import LauncherOldRouter from "./api/routes/launcherOld.routes";
import InteractionsService from "./api/services/Interactions/Interactions.service";
import SubServerStatusService from "./api/services/server/sub-server-status.service";
import SocketRouter from "./api/routes/socket.routes";
import AuthJwtVerify from "./api/middlewares/authJwtVerify";
import SocketIo from "./socket/SocketIo";
import { errorMiddleware } from "./api/middlewares/error.middleware";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger";

export default class App {
  private _app: express.Application;
  private _privateKey: string | null = null;
  private _certificate: string | null = null;
  private _io: socketIo.Server | null = null;

  constructor() {
    // ConfigService 會在初始化時自動驗證必要變數
    if (config.ssl) {
      this._privateKey = fs.readFileSync(config.ssl.keyPath, "utf8");
      this._certificate = fs.readFileSync(config.ssl.certPath, "utf8");
    }

    this._app = express();
    this._init();
    this._settings();
    this._middleware();
    this._routes();
  }

  private _init(): void {
    logger.info(`Api Service start model: ${config.env}`);
    logger.info(`Api Service Version: ${environment.api_version}`);
    Mysql.connect();
    InteractionsService.initLoopPings();
    SubServerStatusService.initStatusLoop();
  }

  private _settings(): void {
    this._app.set("views", path.join(__dirname, "views"));
    // this._app.set("view engine", "ejs");
    this._app.set("trust proxy", 1);
  }

  private _middleware(): void {
    if (config.isDevelopment) {
      this._app.use(cors());
    }

    // Swagger UI 路由
    this._app.use(
      "/api-docs",
      swaggerUi.serve as any,
      swaggerUi.setup(swaggerSpec) as any,
    );

    this._app.use(helmet());
    this._app.use(
      pinoHttp({
        logger,
        customLogLevel(_req, res, err) {
          if (err || res.statusCode >= 500) return "error";
          if (res.statusCode >= 400) return "warn";
          return "info";
        },
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ status: res.statusCode }),
        },
      }),
    );
    this._app.use(express.json({ limit: "10MB" }));
    // this._app.use(express.static(path.join(__dirname, "public")));
    this._app.use(express.urlencoded({ extended: true }));
    this._app.use(cookieParser());
  }

  private _routes(): void {
    new IndexRoutes(this._app);
    new AuthRoutes(this._app);
    new WhitelistRoutes(this._app);
    new UserRouter(this._app);
    new SponsorRouter(this._app);
    new ViolationRouter(this._app);
    new LauncherRouter(this._app);
    new ServerRouter(this._app);
    new ModsRoutes(this._app);
    new ModpacksRoutes(this._app);
    new LauncherV2Router(this._app);
    new SocketRouter(this._app);
    // new InteractionsRouter(this._app);

    // old
    new LauncherOldRouter(this._app);

    // 全域錯誤處理（必須放在所有路由之後）
    this._app.use(errorMiddleware);
  }

  public listen(port: number): void {
    this._app.set("port", port || 3000);

    const httpServer = http.createServer(this._app);

    httpServer.listen(port, () => {
      logger.info(`Http Api Service listening on PORT ${this._app.get("port")}`);
    });

    new SocketIo(httpServer).listeners();

    // this._io.on("connection", (socket) => {
    //     setInterval(() => {
    //         socket.emit("message", "Hi Quasi.");
    //     }, 2000);
    // });

    // if (this._privateKey !== null && this._certificate !== null) {

    //     const httpsServer = https.createServer({ key: this._privateKey, cert: this._certificate }, this._app);

    //     httpsServer.listen(port, () => {
    //         Logs.info("Https Api Service listening on PORT " + this._app.get("port"));
    //     });

    // } else {

    //     const httpServer = http.createServer(this._app);

    //     httpServer.listen(port, () => {
    //         Logs.info("Http Api Service listening on PORT " + this._app.get("port"));
    //     });

    // }
  }
}
