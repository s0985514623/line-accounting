@command
Feature: 刪除分類
  作為 記帳者
  我要 在 LIFF 刪除不再使用的分類
  以便 保持分類清單簡潔

  # 觸發：DELETE /api/categories/{id}
  # 刪除後：該分類的記帳紀錄改歸同帳本同收支的「其他」，該分類的關鍵字一併刪除

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 2  | 個人 | 支出 | 其他 | 是       |
      | 9  | 個人 | 支出 | 寵物 | 否       |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 刪除分類 9
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（狀態）- 分類必須存在

    Example: 刪除不存在的分類時操作失敗
      When 記帳者以 LIFF 刪除分類 99
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 前置（狀態）- 「其他」分類不可刪除

    Example: 刪除其他分類時操作失敗
      When 記帳者以 LIFF 刪除分類 2
      Then 操作失敗，violation_type 為 "FALLBACK_CATEGORY_UNDELETABLE"

  Rule: 後置（狀態）- 分類被刪除，其記帳紀錄改歸同帳本同收支的「其他」，其關鍵字被刪除

    Example: 刪除有紀錄與關鍵字的分類
      Given 系統中有以下記帳紀錄：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 飼料 | 800  | 寵物 | 2026-11-01 |      | LINE文字 |
        | 11 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-02 |      | LINE文字 |
      And 系統中有以下分類關鍵字：
        | 帳本 | 收支 | 關鍵字 | 分類 |
        | 個人 | 支出 | 飼料   | 寵物 |
        | 個人 | 支出 | 午餐   | 餐飲 |
      When 記帳者以 LIFF 刪除分類 9
      Then 操作成功
      And 分類應為：
        | 帳本 | 收支 | 名稱 | 其他分類 |
        | 個人 | 支出 | 餐飲 | 否       |
        | 個人 | 支出 | 其他 | 是       |
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 飼料 | 800  | 其他 | 2026-11-01 |      | LINE文字 |
        | 11 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-02 |      | LINE文字 |
      And 分類關鍵字應為：
        | 帳本 | 收支 | 關鍵字 | 分類 |
        | 個人 | 支出 | 午餐   | 餐飲 |
