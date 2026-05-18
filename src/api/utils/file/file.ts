/**
 * @file file.ts
 * @description 將 Base64 編碼內容解碼並寫入對應的 Launcher 問題日誌目錄
 * @methods
 *   - writeFile: 依 type（github / launcher / startError）決定路徑並寫入檔案
 * @dependencies fs-extra, dates
 */
import Dates from "../dates";
import * as path from "path";
import * as fs from "fs-extra";

export default class File {

    private static _fileDirPath = path.join(__dirname, "..", "..", "..", "..", "..", "files");

    public static writeFile(type: string, fileName: string, issueId: string, content: string): void {

        const date = new Dates();

        let filePath = "";

        switch (type) {
            case "github":
                filePath = path.join(this._fileDirPath, "launcher-Issue", "github", date.fullYearTime().split(" ")[0], issueId, fileName);
                break;
            case "launcher":
                filePath = path.join(this._fileDirPath, "launcher-Issue", "message", date.fullYearTime().split(" ")[0], issueId, fileName);
                break;
            case "startError":
                filePath = path.join(this._fileDirPath, "launcher-Issue", "startError", date.fullYearTime().split(" ")[0], issueId, fileName);
                break;
            default:
                filePath = path.join(this._fileDirPath, "launcher-Issue", "undefined", date.fullYearTime().split(" ")[0], issueId, fileName);
                break;
        }

        const fileContent = Buffer.from(content, "base64").toString("utf8");

        fs.ensureDirSync(path.join(filePath, ".."));
        fs.writeFileSync(filePath, fileContent, "utf8");
    }

}
