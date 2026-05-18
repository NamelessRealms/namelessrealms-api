/**
 * @file CheckSocketConnection.ts
 * @description Socket 事件：CHECK_SOCKET_CONNECTION，檢查指定 clientType + clientId 是否線上並回傳結果
 * @dependencies SocketIo, ISockerEvent
 */
import { Socket } from "socket.io";
import SocketIo from "../SocketIo";
import ISockerEvent, { ContainerType, ICheckSocketConnection, IEventType } from "./ISockerEvent";

export default class CheckSocketConnection implements ISockerEvent<"CHECK_SOCKET_CONNECTION"> {

    public event: keyof IEventType = "CHECK_SOCKET_CONNECTION";

    public execute(socket: Socket, clientType: ContainerType, clientId: string, data: ICheckSocketConnection): void {
        const checkSocket = SocketIo.getSocket(data.clientType, data.clientId);
        socket.emit("CHECK_SOCKET_CONNECTION", checkSocket !== null);
    }
}