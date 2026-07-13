/**
 * @file httpServer.ts
 * @description 測試用極簡本地 HTTP server：回傳固定位元組並計數請求，供池下載路徑測試使用（不外連）。
 */
import http from "http";
import type { AddressInfo } from "net";

export interface TestServer {
  /** 基底 URL（含隨機埠） */
  url: string;
  /** 至今收到的請求數 */
  count: () => number;
  /** 最近一次請求的 headers */
  lastHeaders: () => http.IncomingHttpHeaders;
  /** 關閉 server */
  close: () => Promise<void>;
}

/**
 * 啟動一個回傳固定位元組的本地 HTTP server。
 *
 * @param body - 每個請求回傳的位元組
 */
export async function startBytesServer(body: Buffer): Promise<TestServer> {
  let requests = 0;
  let headers: http.IncomingHttpHeaders = {};

  const server = http.createServer((req, res) => {
    requests++;
    headers = req.headers;
    res.writeHead(200, { "Content-Length": String(body.length) });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    count: () => requests,
    lastHeaders: () => headers,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
