/**
 * @file minecraftServerPing.ts
 * @description 以 Minecraft Server List Ping (SLP) 協定查詢伺服器線上狀態與人數，無需伺服器端安裝任何 plugin
 * @methods
 *   - pingMinecraftServer: 連線 host:port 取得 { online, max }，逾時/連不上回傳 null（視為離線）
 * @dependencies net（Node 內建）
 * @notes 走 1.7+ 的現代 SLP 握手流程；只發 Handshake + Status Request，不做 latency ping
 */
import net from "net";

export interface PingResult {
  /** 目前線上人數 */
  online: number;
  /** 人數上限 */
  max: number;
}

/** 將非負整數編碼為 Minecraft VarInt */
function writeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  while (true) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes);
}

/**
 * 從 buffer 的 offset 讀取一個 VarInt。
 * 資料不足以讀完時回傳 null（呼叫端應等待更多位元組）。
 */
function readVarInt(buf: Buffer, offset: number): { value: number; size: number } | null {
  let value = 0;
  let position = 0;
  let read = 0;
  while (true) {
    if (offset + read >= buf.length) return null;
    const byte = buf[offset + read];
    value |= (byte & 0x7f) << position;
    read++;
    if ((byte & 0x80) === 0) break;
    position += 7;
    if (position >= 32) throw new Error("VarInt 過長");
  }
  return { value, size: read };
}

/** 組出一個帶長度前綴的封包：VarInt(長度) + VarInt(封包 id) + payload */
function buildPacket(packetId: number, ...payloads: Buffer[]): Buffer {
  const data = Buffer.concat([writeVarInt(packetId), ...payloads]);
  return Buffer.concat([writeVarInt(data.length), data]);
}

/**
 * 以 SLP 協定 ping 一台 Minecraft 伺服器。
 *
 * @param host 伺服器位址
 * @param port 伺服器埠
 * @param timeoutMs 連線/回應逾時（毫秒）
 * @returns 線上時回傳 { online, max }；離線、連不上或回應無法解析時回傳 null
 */
export function pingMinecraftServer(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<PingResult | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let resolved = false;
    let recv = Buffer.alloc(0);

    const finish = (result: PingResult | null): void => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));

    socket.on("connect", () => {
      const hostBuf = Buffer.from(host, "utf8");
      const handshake = buildPacket(
        0x00,
        writeVarInt(47), // protocol version（status 階段任意值皆可）
        writeVarInt(hostBuf.length),
        hostBuf,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]), // unsigned short, big-endian
        writeVarInt(1), // next state = 1 (status)
      );
      const statusRequest = buildPacket(0x00);
      socket.write(Buffer.concat([handshake, statusRequest]));
    });

    socket.on("data", (chunk: Buffer) => {
      recv = Buffer.concat([recv, chunk]);

      // 解析回應封包：VarInt(封包總長) + VarInt(封包 id) + VarInt(JSON 長度) + JSON
      const lenRes = readVarInt(recv, 0);
      if (!lenRes) return;
      const totalLen = lenRes.size + lenRes.value;
      if (recv.length < totalLen) return; // 等待更多位元組

      let offset = lenRes.size;
      const idRes = readVarInt(recv, offset);
      if (!idRes) return;
      offset += idRes.size;

      const strLen = readVarInt(recv, offset);
      if (!strLen) return;
      offset += strLen.size;

      const json = recv.slice(offset, offset + strLen.value).toString("utf8");
      try {
        const parsed = JSON.parse(json);
        const players = parsed.players ?? {};
        finish({
          online: Number(players.online ?? 0),
          max: Number(players.max ?? 0),
        });
      } catch {
        finish(null);
      }
    });
  });
}
