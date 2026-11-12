@command
Feature: 編輯記帳紀錄
  作為 記帳者
  我要 在 LIFF 列表中修改一筆紀錄
  以便 更正記錯的帳本、收支、金額、分類、日期或備註

  # 觸發：PUT /api/transactions/{id}（全欄位更新）

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 3  | 個人 | 收入 | 薪資 | 否       |
      | 5  | 公司 | 支出 | 文具 | 否       |
    And 系統中有以下記帳紀錄：
      | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
      | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 編輯記帳紀錄 10：
        | 帳本 | 收支 | 項目 | 金額 | 分類id | 日期       | 備註 |
        | 個人 | 支出 | 午餐 | 150  | 1      | 2026-11-12 |      |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（狀態）- 紀錄必須存在

    Example: 編輯不存在的紀錄時操作失敗
      When 記帳者以 LIFF 編輯記帳紀錄 99：
        | 帳本 | 收支 | 項目 | 金額 | 分類id | 日期       | 備註 |
        | 個人 | 支出 | 午餐 | 150  | 1      | 2026-11-12 |      |
      Then 操作失敗，violation_type 為 "NOT_FOUND"

  Rule: 前置（參數）- 欄位規則同表單記帳（必填、金額正整數、日期合法）

    Scenario Outline: 參數不合法時操作失敗且紀錄不變
      When 記帳者以 LIFF 編輯記帳紀錄 10：
        | 帳本 | 收支 | 項目   | 金額     | 分類id | 日期   | 備註 |
        | 個人 | 支出 | <item> | <amount> | 1      | <date> |      |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

      Examples:
        | item | amount | date       |
        |      | 150    | 2026-11-12 |
        | 午餐 | -1     | 2026-11-12 |
        | 午餐 | 150    | 2026-02-30 |

  Rule: 前置（參數）- 分類必須屬於修改後的帳本與收支

    Example: 改到公司帳本卻沿用個人分類時操作失敗
      When 記帳者以 LIFF 編輯記帳紀錄 10：
        | 帳本 | 收支 | 項目 | 金額 | 分類id | 日期       | 備註 |
        | 公司 | 支出 | 午餐 | 120  | 1      | 2026-11-12 |      |
      Then 操作失敗，violation_type 為 "CATEGORY_MISMATCH"

  Rule: 後置（狀態）- 紀錄所有欄位更新為新值，來源維持不變

    Example: 把個人午餐改成公司文具
      When 記帳者以 LIFF 編輯記帳紀錄 10：
        | 帳本 | 收支 | 項目   | 金額 | 分類id | 日期       | 備註     |
        | 公司 | 支出 | 影印紙 | 300  | 5      | 2026-11-11 | 記錯帳本 |
      Then 操作成功
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目   | 金額 | 分類 | 日期       | 備註     | 來源     |
        | 10 | 公司 | 支出 | 影印紙 | 300  | 文具 | 2026-11-11 | 記錯帳本 | LINE文字 |
