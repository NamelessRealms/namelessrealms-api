<h1 align="center">Nameless Realms API Service</h1>
<p align="center">Nameless Realms 平台的後端 RESTful API 伺服器，基於 Node.js + Express 構建。</p>
<p align="center">
  <img src="https://img.shields.io/badge/version-1.6.2-blue" alt="version" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="license" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="node" />
</p>

---

## 技術棧

- **執行環境**：Node.js 18+
- **框架**：Express 5
- **語言**：TypeScript
- **資料庫**：MySQL 2
- **身份驗證**：JWT（HS256）、Argon2 密碼雜湊
- **郵件服務**：Nodemailer（SMTP）
- **文件**：Swagger / OpenAPI 3.0

## 快速開始

### 1. 安裝相依套件

```bash
yarn install
```

### 2. 設定環境變數

複製以下範本並建立 `.env` 檔案：

```env
# Application
PORT=8030
NODE_ENV=development

# Database
MYSQL_HOST=localhost
MYSQL_USER=namelessrealms
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=namelessrealms

# Security
JWT_SECRET=your_access_token_secret
JWT_REFRESH_SECRET=your_refresh_token_secret
JWT_SALT=your_salt

# Mail (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=admin@namelessrealms.com

# Third Party (Optional)
CURSEFORGE_KEY=your_curseforge_key
WEBHOOKS_ERROR_URL=your_discord_webhook_url

# SSL (Optional)
# SSL_KEY_PATH=./ssl/key.pem
# SSL_CSR_PATH=./ssl/cert.pem
```

### 3. 啟動

```bash
# 開發模式（含熱重載）
yarn dev

# 正式環境
yarn build
yarn start
```

## API 路由

| 模組 | 路由前綴 | 說明 |
|------|---------|------|
| 身份驗證 | `/oauth2/token`、`/register`、`/auth/send-code` | 登入、註冊、OTP 驗證碼 |
| 使用者 | `/user` | 使用者資料管理 |
| 白名單 | `/whitelist` | 伺服器白名單管理 |
| 模組 | `/mods` | Mod 清單管理 |
| 啟動器 | `/launcher` | 啟動器設定與更新 |
| 互動 | `/interactions` | 社群互動功能 |
| 違規 | `/violation` | 違規記錄管理 |

API 文件（Swagger UI）於開發環境啟動後可在以下位址瀏覽：

```
http://localhost:8030/api-docs
```

## 安全機制

- **密碼**：Argon2 雜湊；舊 MD5 格式在登入時自動 Lazy Migration
- **請求頻率限制**：登入 10 次 / 15 分鐘；OTP 發送 3 次 / 10 分鐘
- **JWT**：Access Token 與 Refresh Token 使用獨立 Secret 簽署

## 授權

[GPL-3.0](LICENSE) © Yu
