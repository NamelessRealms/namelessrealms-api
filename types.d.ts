/**
 * @file types.d.ts
 * @description 擴充 Express Request 型別，附加 JWT 解碼資料（user）與 API Key 應用程式上下文（appContext）
 */
declare namespace Express {
  interface IDecoded {
    _id: string;
    iss: string;
    sub: string;
    iat: number;
    exp: number;
    role: string;
  }

  interface IAppContext {
    appName: string;
    permissions: string[];
  }

  export interface Request {
    user?: IDecoded;
    appContext?: IAppContext;
  }
}