/**
 * @file Interactions.service.ts
 * @description 管理外部應用程式互動的 IP 存活追蹤，以靜態 Map 保存連線狀態並定期清除過期 ping 紀錄
 * @methods
 *   - initLoopPings: 啟動定時任務，每 5 分鐘清除過期 ping
 *   - addInteractionCallbackPing: 記錄新的 ping 來源 IP
 *   - addInteractionCallback: 確認 IP 存在後將應用程式加入活躍 Map
 * @notes pings 與 interactionApps 為靜態成員，跨請求共享；過期判定以 Date.now + 5 分鐘為準
 */
export default class InteractionsService {

    public static pings = new Array<{ appId: string, ip: string, expired: number }>();
    public static interactionApps = new Map<string, { ip: string }>();

    public static initLoopPings(): void {
        setInterval(() => {

            InteractionsService.pings = InteractionsService.pings.filter((item) => {
                return Date.now() < item.expired + (5000 * 60);
            });

        }, 300000);
    }

    public addInteractionCallbackPing(appId: string, ip: string | undefined) {

        if (ip === undefined) {
            throw new Error("Interaction ip not null.");
        }

        ip = ip.indexOf("::ffff:") !== -1 ? ip.replace("::ffff:", "") : ip;

        const isIp = InteractionsService.pings.find((item) => item.ip === ip);

        if (isIp) {
            return;
        }

        InteractionsService.pings.push({
            appId: appId,
            ip: ip,
            expired: Date.now()
        });
    }

    public addInteractionCallback(appId: string, ip: string | undefined): boolean {

        if (ip === undefined) {
            throw new Error("Interaction ip not null.");
        }

        ip = ip.indexOf("::ffff:") !== -1 ? ip.replace("::ffff:", "") : ip;

        const isIp = InteractionsService.pings.find((item) => item.ip === ip);

        if (!isIp) {
            return false;
        }

        if (InteractionsService.interactionApps.get(appId) !== undefined) {
            InteractionsService.interactionApps.delete(appId);
        }

        InteractionsService.interactionApps.set(appId, { ip: ip });

        return true;
    }
}
