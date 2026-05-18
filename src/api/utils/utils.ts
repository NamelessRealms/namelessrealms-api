/**
 * @file utils.ts
 * @description 通用工具類別
 * @methods
 *   - isVersion: 比較兩個語意版本字串，回傳是否需要升級
 */
export default class Utils {

    public static isVersion(currVer: string, promoteVer: string): boolean {

        currVer = currVer || "0.0.0";
        promoteVer = promoteVer || "0.0.0";

        if (currVer === promoteVer) return false;

        let currVerArr = currVer.split(".");
        let promoteVerArr = promoteVer.split(".");

        let len = Math.max(currVerArr.length, promoteVerArr.length);

        for (let i = 0; i < len; i++) {
            let proVal = ~~promoteVerArr[i];
            let curVal = ~~currVerArr[i];

            if (proVal < curVal) {
                return false;
            } else if (proVal > curVal) {
                return true;
            }
        }

        return false;
    }
}