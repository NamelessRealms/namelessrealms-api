/**
 * @file CommandRunMcServer.ts
 * @description Socket 事件：COMMAND_RUN_MC_SERVER，雙向轉發 Minecraft 伺服器指令（Discord → mcServer 或反向）
 * @dependencies SocketIo, ISockerEvent
 */
import { Socket } from "socket.io";
import SocketIo from "../SocketIo";
import ISockerEvent, { ContainerType, ICommandRunMcServerDiscord, IEventType } from "./ISockerEvent";

export default class CommandRunMcServer implements ISockerEvent<"COMMAND_RUN_MC_SERVER"> {

    public event: keyof IEventType = "COMMAND_RUN_MC_SERVER";

    public execute(socket: Socket, clientType: ContainerType, clientId: string, command: string | ICommandRunMcServerDiscord): void {

        if(clientType === "mcServer") {

            const mainDiscordSocket = SocketIo.getSocket("Discord", "main");
            if(mainDiscordSocket === null) return;

            mainDiscordSocket.emit(this.event, command);

            return;
        }

        if(clientType === "Discord") {

            const commandAs = command as ICommandRunMcServerDiscord;
            const mcServerSocket = SocketIo.getSocket("mcServer", commandAs.serverId);

            if(mcServerSocket === null) {
                socket.emit(this.event, { error: "server_not_online" });
                return;
            }

            mcServerSocket.emit(this.event, commandAs.commandText);

            return;
        }

    }

} 