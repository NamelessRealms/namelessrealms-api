/**
 * @file SocketIo.ts
 * @description Socket.IO 伺服器管理類別，維護各客戶端類型（Discord / Panel / mcServer）的連線 Map 並派發事件
 * @methods
 *   - listeners: 建立 Socket.IO 伺服器、驗證連線 JWT 並註冊所有事件處理器
 *   - getSocket: 依 clientType 與 clientId 查詢已連線的 Socket 實例
 * @dependencies socket.io, http, AuthJwtVerify, 所有 socket event 類別
 * @notes _containers 為靜態 Map，伺服器重啟後清空；斷線時自動從 Map 移除
 */
import { Server, Socket } from "socket.io";
import * as http from "http";
import SocketEvent from "./events/SocketEvent";
import logger from "../api/utils/logger";
import MessageEvent from "./events/MessageCreate";
import { ContainerType } from "./events/ISockerEvent";
import GetMcServerPlayerTime from "./events/GetMcServerPlayerTime";
import GetMcServerTpsInfo from "./events/GetMcServerTpsInfo";
import GetUserBoost from "./events/GetUserBoost";
import CommandCreate from "./events/CommandCreate";
import MessagePrivateCerate from "./events/MessagePrivateCerate";
import CommandRunMcServer from "./events/CommandRunMcServer";
import AuthJwtVerify from "../api/middlewares/authJwtVerify";
import CheckSocketConnection from "./events/CheckSocketConnection";

export type ProxyType = "Client" | "Server";

export default class SocketIo {

    private static _containers: Map<ContainerType, Array<{ clientId: string, socket: Socket }>> = new Map();
    private _httpServer: http.Server;

    constructor(httpServer: http.Server) {
        this._httpServer = httpServer;
    }

    public listeners() {

        const io = new Server(this._httpServer, {
            cors: {
                origin: "*",
            }
        });

        io.use(new AuthJwtVerify().socketVerifyToken);

        io.on("connection", (socketConnection) => {

            const clientType = socketConnection.handshake.query.clientType as ContainerType;
            const clientId = socketConnection.handshake.query.clientId as string;
            const proxyType = socketConnection.handshake.query.proxyType as ProxyType;
            const proxy = proxyType === undefined ? "Client" : proxyType;

            logger.info("Socket Connection: " + socketConnection.id + " clientType: " + clientType + " clientId: " + clientId);

            const socket = { clientId: clientId, socket: socketConnection };

            if (!SocketIo._containers.has(clientType)) {
                SocketIo._containers.set(clientType, [socket]);
            } else {
                const clientTypeContainers = SocketIo._containers.get(clientType);
                if (clientTypeContainers === undefined) return;
                SocketIo._containers.set(clientType, [...clientTypeContainers, socket]);
            }

            socketConnection.on("disconnect", () => {
                let clientTypeContainers = SocketIo._containers.get(clientType);
                if (clientTypeContainers === undefined) return;
                clientTypeContainers = clientTypeContainers.filter((container) => container.socket.id !== socketConnection.id);
                SocketIo._containers.set(clientType, clientTypeContainers);
                logger.info("Socket Disconnect: " + socketConnection.id + " clientType: " + clientType + " clientId: " + clientId);
                // console.log(SocketIo._containers);
            });

            new SocketEvent(socketConnection, proxy, clientType, clientId).register([
                new MessageEvent(),
                new GetMcServerPlayerTime(),
                new GetMcServerTpsInfo(),
                new GetUserBoost(),
                new CommandCreate(),
                new MessagePrivateCerate(),
                new CommandRunMcServer(),
                new CheckSocketConnection()
            ]);

            // console.log(SocketIo._containers);
        });
    }

    public static getSocket(clientType: ContainerType, clientId: string): Socket | null {

        const sockets = SocketIo._containers.get(clientType);
        if (sockets === undefined || sockets.length === 0) return null;
        const socketData = sockets.find((socket) => socket.clientId === clientId);

        if (socketData === undefined) {
            return null;
        } else {
            return socketData.socket;
        }
    }
}