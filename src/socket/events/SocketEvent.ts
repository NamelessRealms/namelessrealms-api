/**
 * @file SocketEvent.ts
 * @description Socket 事件批量註冊器，將 ISockerEvent 實作陣列綁定至指定 Socket 連線
 * @methods
 *   - register: 迭代事件類別陣列並呼叫 socket.on 綁定各事件
 * @dependencies socket.io, ISockerEvent
 */
import { Socket } from "socket.io";
import Logs from "../../api/utils/logs";
import { ProxyType } from "../SocketIo";
import ISockerEvent, { ContainerType, IEventType } from "./ISockerEvent";

export default class SocketEvent {

    private _socket: Socket;
    private _proxy: ProxyType;
    private _clientType: ContainerType;
    private _clientId: string;

    constructor(socket: Socket, proxy: ProxyType, clientType: ContainerType, clientId: string) {
        this._socket = socket;
        this._proxy = proxy;
        this._clientType = clientType;
        this._clientId = clientId;
    }

    public register(events: Array<ISockerEvent<keyof IEventType>>) {
        events.forEach((eventClass) => {
            // Logs.info(`Register event ${eventClass.event} success.`);
            this._socket.on(eventClass.event, (...args: any) => eventClass.execute(this._socket, this._clientType, this._clientId, ...args));
        });
    }
}