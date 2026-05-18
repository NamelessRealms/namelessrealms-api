/**
 * @file dates.ts
 * @description 日期格式化工具類別，提供各種時間字串格式
 * @methods
 *   - time: 回傳 HH:MM:SS 格式
 *   - fullYearTime: 回傳 YYYY-MM-DD HH:MM:SS 格式
 *   - dateTime: 回傳 MM/DD HH:MM:SS 格式
 */
export default class Dates {
    time(): string {

        const date: Date = new Date();
        const hours = date.getHours().toString();
        const minutes = date.getMinutes().toString();
        const seconds = date.getSeconds().toString();

        return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`;
    }

    fullYearTime(): string {

        const date: Date = new Date();

        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString();
        const day = date.getDate().toString();
        const hours = date.getHours().toString();
        const minutes = date.getMinutes().toString();
        const seconds = date.getSeconds().toString();

        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`;
    }

    dateTime(): string {

        const date: Date = new Date();

        const month = (date.getMonth() + 1).toString();
        const day = date.getDate().toString();
        const hours = date.getHours().toString();
        const minutes = date.getMinutes().toString();
        const seconds = date.getSeconds().toString();

        return `${month.padStart(2, "0")}/${day.padStart(2, "0")} ${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:${seconds.padStart(2, "0")}`;
    }
}
