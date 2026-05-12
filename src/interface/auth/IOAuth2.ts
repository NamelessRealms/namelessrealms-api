export interface IOAuth2 {
  grant_type: string;
  username?: string;
  password?: string;
  role?: Array<string>;
  refresh_token?: string;
}
