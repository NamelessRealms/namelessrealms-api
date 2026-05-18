/**
 * @file CommandCreate.ts
 * @description Socket 事件：COMMAND_CREATE，將 Minecraft 伺服器的玩家指令轉發給 Discord Bot
 * @dependencies SocketIo, ISockerEvent
 */
import { Socket } from "socket.io";
import SocketIo from "../SocketIo";
import ISockerEvent, { ContainerType, ICommandMcServer, IEventType } from "./ISockerEvent";

export default class CommandCreate implements ISockerEvent<"COMMAND_CREATE"> {

    public event: keyof IEventType = "COMMAND_CREATE";

    public execute(socket: Socket, clientType: ContainerType, clientId: string, command: ICommandMcServer): void {

        if(clientType === "mcServer") {

            const mainDiscordSocket = SocketIo.getSocket("Discord", "main");
            if(mainDiscordSocket === null) return;

            mainDiscordSocket.emit(this.event, command);

        }

    }

}