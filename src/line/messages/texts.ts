/**
 * LINE 回覆共用文字常數（逐字對應 specs/features/**.feature，修改前請先比對規格）。
 */

/** 文字記帳格式說明（transaction/以文字訊息記帳.feature；系統抽象.md）。 */
export const FORMAT_HELP_TEXT =
  '格式：[公 ][+]項目 金額[ 備註]，例如：午餐 120、公 +顧問費 30000 A客戶';

/** 白名單使用者加好友時的歡迎訊息（access/加入好友.feature）。 */
export const WELCOME_TEXT = `歡迎使用 LINE 記帳！${FORMAT_HELP_TEXT}`;

/** 非白名單使用者的 follow / message 回覆（access/加入好友.feature）。 */
export const NOT_ALLOWED_TEXT = '此服務不開放使用';

/** 單一事件處理發生未預期例外時的回覆（implementation-plan「錯誤處理登記表」）。 */
export const SYSTEM_BUSY_TEXT = '系統忙碌，請稍後再試';
