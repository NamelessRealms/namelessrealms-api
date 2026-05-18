/**
 * @file IOAuth2.ts
 * @description OAuth2 授權請求體介面，支援 password grant 與 refresh_token grant 兩種流程
 */
export interface IOAuth2 {
  grant_type: string;
  username?: string;
  password?: string;
  role?: Array<string>;
  refresh_token?: string;
}