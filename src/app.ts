import * as express from "express";
import * as path from "path";
import * as morgan from "morgan";
import * as helmet from "helmet";
import * as cookieParser from "cookie-parser";
import * as fs from "fs-extra";
import * as http from "http";
import * as https from "https";
import * as cors from "cors";
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
import ModsRoutes from "./api/routes/mods.routes";
import InteractionsRouter from "./api/routes/interactions.routes";
import LauncherV2Router from "./api/routes/launcherV2.routes";
import ModpacksRoutes from "./api/routes/modpacks.routes";

import Mysql from "./api/utils/mysql";
import Logs from "./api/utils/logs";

// environment
import { environment } from "./environment/environment";
import LauncherOldRouter from "./api/routes/launcherOld.routes";
import InteractionsService from "./api/services/Interactions/Interactions.service";
import SocketRouter from "./api/routes/socket.routes";
import AuthJwtVerify from "./api/middlewares/authJwtVerify";
import SocketIo from "./socket/SocketIo";
import { errorMiddleware } from "./api/middlewares/error.middleware";

export default class App {
  private _app: express.Application;
  private _morganFormat =
    '[:date[iso]] :remote-addr - :remote-user ":method :url :status :response-time ms';
  // private _mySQLStore = require("express-mysql-session")(session);

  // private _sessionOptions = {
  //     secret: "@@!!@@",
  //     resave: false,
  //     saveUninitialized: true,
  //     store: new this._mySQLStore({
  //         host: process.env.MYSQL_HOST,
  //         user: process.env.MYSQL_USER,
  //         password: process.env.MYSQL_PASSWORD,
  //         database: process.env.MYSQL_DATABASE
  //     })
  // }

  // private _credentials: { key: string, cert: string } | null = null;

  private _privateKey: string | null = null;
  private _certificate: string | null = null;
  private _io: socketIo.Server | null = null;

  constructor() {
    if (process.env.MYSQL_HOST === undefined)
      throw new Error("Env MYSQL_HOST not null.");
    if (process.env.MYSQL_USER === undefined)
      throw new Error("Env MYSQL_USER not null.");
    if (process.env.MYSQL_PASSWORD === undefined)
      throw new Error("Env MYSQL_PASSWORD not null.");
    if (process.env.MYSQL_DATABASE === undefined)
      throw new Error("Env MYSQL_DATABASE not null.");
    if (process.env.JWT_SALT === undefined)
      throw new Error("Env JWT_SALT not null.");
    if (process.env.JWT_SECRET === undefined)
      throw new Error("Env JWT_SECRET not null.");

    if (
      process.env.SSL_KEY_PATH !== undefined &&
      process.env.SSL_CSR_PATH !== undefined
    ) {
      this._privateKey = fs.readFileSync(process.env.SSL_KEY_PATH, "utf8");
      this._certificate = fs.readFileSync(process.env.SSL_CSR_PATH, "utf8");
      // this._credentials = { key: privateKey, cert: certificate };
    }

    this._app = express();
    this._init();
    this._settings();
    this._middleware();
    this._routes();
  }

  private _init(): void {
    Logs.info(`Api Service start model: ${process.env.NODE_ENV}`);
    Logs.info(`Api Service Version: ${environment.api_version}`);
    Mysql.connect();
    InteractionsService.initLoopPings();
  }

  private _settings(): void {
    this._app.set("views", path.join(__dirname, "views"));
    // this._app.set("view engine", "ejs");
    this._app.enable("trust proxy");
    // this._app.set("trust proxy", "127.0.0.1");
  }

  private _middleware(): void {
    if (process.env.NODE_ENV === "development") {
      this._app.use(cors());
    }

    this._app.use(helmet());
    this._app.use(
      morgan(
        process.env.NODE_ENV === "development" ? "dev" : this._morganFormat,
      ),
    );
    this._app.use(express.json({ limit: "10MB" }));
    // this._app.use(express.static(path.join(__dirname, "public")));
    this._app.use(express.urlencoded({ extended: true }));
    this._app.use(cookieParser());
    // this._app.use(session(this._sessionOptions));
  }

  private _routes(): void {
    new IndexRoutes(this._app);
    new AuthRoutes(this._app);
    new WhitelistRoutes(this._app);
    new UserRouter(this._app);
    new SponsorRouter(this._app);
    new ViolationRouter(this._app);
    new LauncherRouter(this._app);
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
      Logs.info("Http Api Service listening on PORT " + this._app.get("port"));
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
