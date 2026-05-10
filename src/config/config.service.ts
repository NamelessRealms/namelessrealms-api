import "dotenv/config";

interface IDatabaseConfig {
  host: string;
  user: string;
  pass: string;
  name: string;
}

interface IJwtConfig {
  secret: string;
  refreshSecret: string;
  salt: string;
}

interface IMailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

interface IConfig {
  env: string;
  port: number;
  db: IDatabaseConfig;
  jwt: IJwtConfig;
  mail: IMailConfig;
  curseforgeKey: string;
  webhooksErrorUrl: string;
  ssl?: {
    keyPath: string;
    certPath: string;
  };
}

export default class ConfigService {
  private static _instance: ConfigService;
  private _config: IConfig;

  private constructor() {
    this._config = this._loadConfig();
    this._validateConfig();
  }

  public static getInstance(): ConfigService {
    if (!ConfigService._instance) {
      ConfigService._instance = new ConfigService();
    }
    return ConfigService._instance;
  }

  private _loadConfig(): IConfig {
    return {
      env: process.env.NODE_ENV || "development",
      port: parseInt(process.env.PORT || "3000", 10),
      db: {
        host: process.env.MYSQL_HOST || "",
        user: process.env.MYSQL_USER || "",
        pass: process.env.MYSQL_PASSWORD || "",
        name: process.env.MYSQL_DATABASE || "",
      },
      jwt: {
        secret: process.env.JWT_SECRET || "",
        refreshSecret: process.env.JWT_REFRESH_SECRET || "",
        salt: process.env.JWT_SALT || "",
      },
      curseforgeKey: process.env.CURSEFORGE_KEY || "",
      webhooksErrorUrl: process.env.WEBHOOKS_ERROR_URL || "",
      mail: {
        host: process.env.SMTP_HOST || "",
        port: parseInt(process.env.SMTP_PORT || "587", 10),
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
        from: process.env.SMTP_FROM || "",
      },
      ssl:
        process.env.SSL_KEY_PATH && process.env.SSL_CSR_PATH
          ? {
              keyPath: process.env.SSL_KEY_PATH,
              certPath: process.env.SSL_CSR_PATH,
            }
          : undefined,
    };
  }

  private _validateConfig(): void {
    const missingFields: string[] = [];

    if (!this._config.db.host) missingFields.push("MYSQL_HOST");
    if (!this._config.db.user) missingFields.push("MYSQL_USER");
    if (!this._config.db.pass) missingFields.push("MYSQL_PASSWORD");
    if (!this._config.db.name) missingFields.push("MYSQL_DATABASE");
    if (!this._config.jwt.secret) missingFields.push("JWT_SECRET");
    if (!this._config.jwt.refreshSecret) missingFields.push("JWT_REFRESH_SECRET");
    if (!this._config.jwt.salt) missingFields.push("JWT_SALT");

    if (missingFields.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingFields.join(", ")}`,
      );
    }
  }

  public get env() {
    return this._config.env;
  }
  public get isDevelopment() {
    return this._config.env === "development";
  }
  public get port() {
    return this._config.port;
  }
  public get db() {
    return this._config.db;
  }
  public get jwt() {
    return this._config.jwt;
  }
  public get curseforgeKey() {
    return this._config.curseforgeKey;
  }
  public get webhooksErrorUrl() {
    return this._config.webhooksErrorUrl;
  }
  public get mail() {
    return this._config.mail;
  }
  public get ssl() {
    return this._config.ssl;
  }
}

export const config = ConfigService.getInstance();
