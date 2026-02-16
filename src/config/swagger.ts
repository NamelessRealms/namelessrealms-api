import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "NamelessRealms API",
      version: "1.0.0",
      description:
        "NamelessRealms 核心服務 API 文件，包含認證、贊助管理及後續擴展服務。",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "請輸入您的 JWT Token (不需要包含 Bearer 字眼)",
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    servers: [
      {
        url: "http://localhost:8030",
        description: "本地開發伺服器",
      },
    ],
  },
  // 掃描包含註解的檔案路徑
  apis: ["./src/api/controllers/*.ts", "./src/api/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);
