@command
Feature: 刪除記帳紀錄
  作為 記帳者
  我要 在 LIFF 列表中刪除一筆紀錄
  以便 移除記錯的收支

  # 觸發：DELETE /api/transactions/{id}（LIFF 前端自行顯示確認對話框）

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
    And 系統中有以下記帳紀錄：
      | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
      | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗且紀錄保留
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 刪除記帳紀錄 10
      Then 操作失敗，violation_type 為 "<violation>"
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（狀態）- 紀錄必須存在

    Example: 刪除不存在的紀錄時操作失敗
      When 記帳者以 LIFF 刪除記帳紀錄 99
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 後置（狀態）- 紀錄被硬刪除

    Example: 刪除後紀錄消失
      When 記帳者以 LIFF 刪除記帳紀錄 10
      Then 操作成功
      And 記帳紀錄應為空
