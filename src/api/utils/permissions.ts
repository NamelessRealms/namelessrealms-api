/**
 * @file permissions.ts
 * @description 伺服器權限旗標常數與 bitmask 檢查工具
 */

export const Permission = {
  MANAGE_SERVER:    1 << 0,   // 1  — 改設定、上傳 icon/background
  MANAGE_ROLES:     1 << 1,   // 2  — 建立/編輯/刪除角色
  MANAGE_MEMBERS:   1 << 2,   // 4  — 邀請/移除成員、指派角色
  MANAGE_WHITELIST: 1 << 3,   // 8  — 審核白名單申請
  ADMINISTRATOR:    1 << 31,  // 2147483648 — 所有權限（Owner 專用）
} as const;

export type PermissionFlag = typeof Permission[keyof typeof Permission];

/**
 * 檢查使用者的權限 bitmask 是否包含指定權限。
 * ADMINISTRATOR 旗標永遠通過所有檢查。
 */
export function hasPermission(userPerms: number, required: number): boolean {
  if (userPerms & Permission.ADMINISTRATOR) return true;
  return (userPerms & required) !== 0;
}
