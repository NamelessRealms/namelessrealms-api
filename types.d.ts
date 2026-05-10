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
