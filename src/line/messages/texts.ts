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

/** 金額為 0、負數或小數（transaction/以文字訊息記帳.feature）。 */
export const AMOUNT_NOT_POSITIVE_INTEGER_TEXT = '金額必須為正整數';

/** 金額超過 99,999,999（ASM-03）。 */
export const AMOUNT_TOO_LARGE_TEXT = '金額超過上限';

/** 項目超過 50 字（ASM-04）。 */
export const ITEM_TOO_LONG_TEXT = '項目最多 50 字';

/** 分類按鈕 postback data 超過 300 字元（ASM-05）。 */
export const NOTE_TOO_LONG_TEXT = '備註太長，請縮短後重新傳送，或改用表單記帳';

/** 分類按鈕 postback data 解碼失敗（竄改、缺欄位、欄位不合法；ASM-07）。 */
export const POSTBACK_DATA_INVALID_TEXT = '資料格式錯誤，請重新記帳';

/** 分類按鈕 token 已使用（transaction/選擇分類完成記帳.feature）。 */
export const PICK_ALREADY_USED_TEXT = '此筆已記帳';

/** 選擇的分類不存在（transaction/選擇分類完成記帳.feature）。 */
export const PICK_CATEGORY_NOT_FOUND_TEXT = '分類不存在，請重新記帳';

/** 選擇的分類與帳本或收支不符（transaction/選擇分類完成記帳.feature）。 */
export const PICK_CATEGORY_MISMATCH_TEXT = '分類不符，請重新記帳';
