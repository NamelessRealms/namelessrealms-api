/**
 * @file GetMcServerPlayerTime.ts
 * @description Socket 事件：GET_MC_SERVER_PLAYER_TIME，查詢指定玩家的遊玩時間（Discord 發起，mcServer 回應）
 * @dependencies SocketIo, ISockerEvent
 */
import { Socket } from "socket.io";
import SocketIo from "../SocketIo";
import ISockerEvent, { ContainerType, IEventType, IGetMcServerPlayerTimeDiscord, IGetMcServerPlayerTimeMcServer } from "./ISockerEvent";

export default class GetMcServerPlayerTime implements ISockerEvent<"GET_MC_SERVER_PLAYER_TIME"> {

    public event: keyof IEventType = "GET_MC_SERVER_PLAYER_TIME";

    public execute(socket: Socket, clientType: ContainerType, clientId: string, playerData: IGetMcServerPlayerTimeDiscord | IGetMcServerPlayerTimeMcServer[]): void {

        if(clientType === "mcServer") {

            const mainDiscordSocket = SocketIo.getSocket("Discord", "main");
            if(mainDiscordSocket === null) return;

            mainDiscordSocket.emit(this.event, playerData);

            return;
        }

        if(clientType === "Discord") {

            const playerDataAs = playerData as IGetMcServerPlayerTimeDiscord;
            const mcServerSocket = SocketIo.getSocket("mcServer", playerDataAs.serverId);

            if(mcServerSocket === null) {
                socket.emit(this.event, { error: "server_not_online" });
                return;
            }

            mcServerSocket.emit(this.event, { players: playerDataAs.players });

            return;
        }

    }

}