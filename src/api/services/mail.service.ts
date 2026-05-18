/**
 * @file mail.service.ts
 * @description 透過 SMTP 發送系統郵件，目前支援發送信箱驗證碼
 * @methods
 *   - sendVerificationCode: 發送含 6 位數驗證碼的 HTML 郵件
 * @dependencies nodemailer, config.service
 */
import nodemailer from "nodemailer";
import { config } from "../../config/config.service";
import Logs from "../utils/logs";

export default class MailService {
  private _transporter: nodemailer.Transporter;

  constructor() {
    this._transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465, // true for 465, false for other ports
      auth: {
        user: config.mail.user,
        pass: config.mail.pass,
      },
    });
  }

  /**
   * 發送驗證碼郵件
   * @param email 收件者信箱
   * @param code 驗證碼
   */
  public async sendVerificationCode(email: string, code: string): Promise<void> {
    const mailOptions = {
      from: `"Nameless Realms - Nymless Team" <${config.mail.from}>`,
      to: email,
      subject: "您的註冊驗證碼",
      text: `您的驗證碼是：${code}。有效期為 10 分鐘。`,
      html: `<p>您的驗證碼是：<b>${code}</b></p><p>有效期為 10 分鐘。</p>`,
    };

    try {
      await this._transporter.sendMail(mailOptions);
      Logs.info(`Verification code sent to ${email}`);
    } catch (error) {
      Logs.error(`Failed to send email to ${email}: ${error}`);
      throw new Error("無法發送驗證碼郵件，請稍後再試。");
    }
  }
}
