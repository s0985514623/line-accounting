/**
 * LINE 回覆共用文字常數（逐字對應 specs/features/**.feature，修改前請先比對規格）。
 */

/** 文字記帳格式說明（transaction/以文字訊息記帳.feature；系統抽象.md）。 */
export const FORMAT_HELP_TEXT =
  '格式：[公 ][日期 ][+]項目 金額[ 備註]，例如：午餐 120、昨天 午餐 120、公 11/10 +顧問費 30000 A客戶；多筆請分行輸入';

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

/** 要刪除 / 取消刪除的記帳紀錄不存在（transaction/請求刪除記帳紀錄.feature、確認刪除記帳紀錄.feature）。 */
export const RECORD_NOT_FOUND_TEXT = '此紀錄已不存在';

/** 刪除確認提示選擇「取消」（transaction/確認刪除記帳紀錄.feature）。 */
export const DELETE_CANCELLED_TEXT = '已取消刪除';

/** 日期前綴在日曆上不存在（例：2/30）或月 / 日超出範圍。 */
export const DATE_INVALID_TEXT = '日期不存在';

/** 日期前綴晚於今天。 */
export const DATE_FUTURE_TEXT = '日期不可晚於今天';

/** 批次記帳一次最多行數。 */
export const MAX_BATCH_LINES = 30;

/** 批次記帳超過行數上限。 */
export const BATCH_TOO_MANY_LINES_TEXT = `一次最多 ${MAX_BATCH_LINES} 筆，請分次傳送`;

/** 批次中某行格式錯誤（逐行列出時使用，完整格式說明另附一次）。 */
export const BATCH_LINE_FORMAT_ERROR_TEXT = '格式錯誤';

/** 批次中出現單行指令（本月 / 上月 / 待分類）。 */
export const BATCH_LINE_COMMAND_TEXT = '指令請單獨傳送';

/** 固定收支某一期已確認或略過過。 */
export const OCCURRENCE_RESOLVED_TEXT = '此期固定收支已處理過';

/** 固定收支某一期不存在（規則已刪除）。 */
export const OCCURRENCE_NOT_FOUND_TEXT = '此固定收支已不存在';

/** 「固定」但沒有任何固定收支。 */
export const NO_RECURRING_TEXT = '目前沒有設定每月固定收支';

/** 「待分類」但沒有待分類項目。 */
export const NO_PENDING_TEXT = '目前沒有待分類的項目';

/** 批次待分類項目全部完成。 */
export const BATCH_ALL_DONE_TEXT = '批次項目已全部分類完成';

/** 批次中沿用的日期（上方第 line 行）有誤。 */
export function batchInheritedDateErrorText(line: number): string {
  return `沿用第 ${line} 行的日期有誤`;
}
