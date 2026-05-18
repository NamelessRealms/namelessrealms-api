/**
 * @file socket.routes.ts
 * @description Socket 路由（前綴 /socket）：透過 HTTP 觸發 Socket.IO 事件廣播
 * @dependencies IRoutes
 */
import { Application } from "express";

import IRoutes from "./IRoutes";

export default class SocketRouter extends IRoutes {

    constructor(app: Application) {
        super(app, "/socket");
    }

    protected _loadRoutes(): void {

        this._routers
            .get("/newOrder", (req, res) => {

                (req.app as any).io.emit('newOrder', { hasOrder: true });
                res.status(201).end();

            });

    }
}