/**
 * @file GetMcServerTpsInfo.ts
 * @description Socket 事件：GET_MC_SERVER_TPS_INFO，查詢 Minecraft 伺服器 TPS 與玩家數（Discord 發起，mcServer 回應）
 * @dependencies SocketIo, ISockerEvent
 */
import { Socket } from "socket.io";
import SocketIo from "../SocketIo";
import ISockerEvent, { ContainerType, IEventType, IGetMcServerTpsInfoDiscord, IGetMcServerTpsInfoMcServer } from "./ISockerEvent";

export default class GetMcServerTpsInfo implements ISockerEvent<"GET_MC_SERVER_TPS_INFO"> {

    public event: keyof IEventType = "GET_MC_SERVER_TPS_INFO";

    public execute(socket: Socket, clientType: ContainerType, clientId: string, data: IGetMcServerTpsInfoMcServer | IGetMcServerTpsInfoDiscord): void {

        if(clientType === "mcServer") {

            const mainDiscordSocket = SocketIo.getSocket("Discord", "main");
            if(mainDiscordSocket === null) return;

            mainDiscordSocket.emit(this.event, data);

            return;
        }

        if(clientType === "Discord") {

            const dataAs = data as IGetMcServerTpsInfoDiscord;
            const mcServerSocket = SocketIo.getSocket("mcServer", dataAs.serverId);

            if(mcServerSocket === null) {
                socket.emit(this.event, { error: "server_not_online" });
                return;
            }

            mcServerSocket.emit(this.event);

            return;
        }

    }
}