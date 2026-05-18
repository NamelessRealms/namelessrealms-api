/**
 * @file verifyRequest.ts
 * @description 支援單筆或陣列請求體的參數驗證輔助工具
 * @methods
 *   - verifyParameter: 對單筆或陣列中每筆資料執行自訂驗證函式
 */
export default class VerifyRequest {

    public static verifyParameter(requestBody: any, verifyParameterMethod: Function): boolean {

        if (Array.isArray(requestBody)) {
            for (let body of requestBody) {
                if (!verifyParameterMethod(body)) {
                    return false;
                }
            }
        } else if (!verifyParameterMethod(requestBody)) {
            return false;
        }

        return true;
    }
}
