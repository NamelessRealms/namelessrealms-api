/**
 * @file IRoutes.ts
 * @description 所有路由類別的抽象基底類別，初始化 Router 並提供共用的驗證中介層實例
 * @methods
 *   - constructor: 建立 Router、載入路由，並將 Router 掛載至 app
 *   - _loadRoutes: 由子類別實作，定義各自的路由規則
 * @dependencies express, AuthJwtVerify, VerifyApiKey
 */
import { Router, Application } from "express";
import AuthJwtVerify from "../middlewares/authJwtVerify";
import { VerifyApiKey } from "../middlewares/verifyApiKey";

export default abstract class IRoutes {
  protected _routers: Router;
  protected _authJwtVerify = new AuthJwtVerify();
  protected _verifyApiKey = new VerifyApiKey();

  constructor(app: Application, routerRoot?: string) {
    this._routers = Router();
    this._loadRoutes();

    if (routerRoot === undefined) {
      app.use(this._routers);
    } else {
      app.use(routerRoot, this._routers);
    }
  }

  protected abstract _loadRoutes(): void;
}
