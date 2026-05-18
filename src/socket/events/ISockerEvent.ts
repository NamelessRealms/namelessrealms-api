/**
 * @file ISockerEvent.ts
 * @description Socket 事件的介面定義與所有事件資料型別，包含訊息、指令、TPS 資訊、玩家時間等
 * @notes ContainerType 定義三種客戶端角色：Discord Bot、Panel 後台、Minecraft 伺服器
 */
import { Socket } from "socket.io";

export interface IMessageMcServer {
    username: string;
    uuid: string;
    content: string;
}

export interface IMessageDiscord {
    serverId: string;
    username: string;
    content: string;
}

export interface IMessagePrivateMcServer {
    senderName: string;
    recipientName: string;
    context: string;
    pos: string;
    level: string;
}

export interface ICommandMcServer {
    commandName: string;
    senderName: string;
    commandString: string;
    pos: string;
    level: string;
    op: boolean;
}

export interface IGetUserBoostMcServer {
    uuid: string;
}

export interface IGetUserBoostDiscord {
    serverId: string;
    boostRole: boolean;
}

export interface ICheckSocketConnection {
    clientType: ContainerType;
    clientId: string;
}

export interface IGetMcServerTpsInfoMcServer {
    playerList: number;
    meanTPS: string;
    meanTickTime: string;
}

export interface IGetMcServerTpsInfoDiscord {
    serverId: string;
}

export interface IGetMcServerPlayerTimeDiscord {
    serverId: string;
    players: Array<{ minecraftUuid: string; }>;
}

export interface IGetMcServerPlayerTimeMcServer {
    minecraftUuid: string;
    playTime: string;
}

export interface ICommandRunMcServerDiscord {
    serverId: string;
    commandText: string;
}

export interface IEventType {
    MESSAGE_CREATE: [message: IMessageDiscord | IMessageMcServer];

    MESSAGE_PRIVATE_CREATE: [message: IMessagePrivateMcServer];

    COMMAND_CREATE: [command: ICommandMcServer];

    GET_USER_BOOST: [user: IGetUserBoostMcServer | IGetUserBoostDiscord];

    CHECK_SOCKET_CONNECTION: [data: ICheckSocketConnection];

    GET_MC_SERVER_TPS_INFO: [data: IGetMcServerTpsInfoMcServer | IGetMcServerTpsInfoDiscord];

    GET_MC_SERVER_PLAYER_TIME: [playerData: IGetMcServerPlayerTimeDiscord | Array<IGetMcServerPlayerTimeMcServer>];

    COMMAND_RUN_MC_SERVER: [command: ICommandRunMcServerDiscord | string];
}

export type ContainerType = "Discord" | "Panel" | "mcServer";

export default interface ISockerEvent<Key extends keyof IEventType> {

    event: keyof IEventType;

    execute(socket: Socket, clientType: ContainerType, clientId: string, ...args: IEventType[Key]): void;
}