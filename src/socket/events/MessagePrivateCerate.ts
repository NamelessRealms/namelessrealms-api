/**
 * @file MessagePrivateCerate.ts
 * @description Socket 事件：MESSAGE_PRIVATE_CREATE，將 Minecraft 私聊訊息轉發給 Discord Bot
 * @dependencies SocketIo, ISockerEvent
 */
import { Socket } from "socket.io";
import SocketIo from "../SocketIo";
import ISockerEvent, { ContainerType, IEventType, IMessagePrivateMcServer } from "./ISockerEvent";

export default class MessagePrivateCerate implements ISockerEvent<"MESSAGE_PRIVATE_CREATE"> {

    public event: keyof IEventType = "MESSAGE_PRIVATE_CREATE";

    public execute(socket: Socket, clientType: ContainerType, clientId: string, message: IMessagePrivateMcServer): void {

        if(clientType === "mcServer") {

            const mainDiscordSocket = SocketIo.getSocket("Discord", "main");
            if(mainDiscordSocket === null) return;

            mainDiscordSocket.emit(this.event, message);

        }

    }
}