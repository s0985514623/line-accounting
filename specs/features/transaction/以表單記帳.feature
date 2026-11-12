@command
Feature: 以表單記帳
  作為 記帳者
  我要 在 LIFF 表單填寫並送出記帳
  以便 補記過去日期或需要完整欄位的收支

  # 觸發：POST /api/transactions（Authorization: Bearer <LIFF ID token>）

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 3  | 個人 | 收入 | 薪資 | 否       |
      | 5  | 公司 | 支出 | 文具 | 否       |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 新增記帳紀錄：
        | 帳本 | 收支 | 項目 | 金額 | 分類id | 日期       | 備註 |
        | 個人 | 支出 | 午餐 | 120  | 1      | 2026-11-10 |      |
      Then 操作失敗，violation_type 為 "<violation>"
      And 記帳紀錄應為空

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（參數）- 帳本、收支、項目、金額、分類、日期為必填，金額為正整數，日期為合法 YYYY-MM-DD

    Scenario Outline: 參數不合法時操作失敗
      When 記帳者以 LIFF 新增記帳紀錄：
        | 帳本     | 收支   | 項目   | 金額     | 分類id | 日期   | 備註 |
        | <ledger> | <type> | <item> | <amount> | <cat>  | <date> |      |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"
      And 記帳紀錄應為空

      Examples:
        | ledger | type | item | amount | cat | date       |
        |        | 支出 | 午餐 | 120    | 1   | 2026-11-10 |
        | 個人   |      | 午餐 | 120    | 1   | 2026-11-10 |
        | 個人   | 支出 |      | 120    | 1   | 2026-11-10 |
        | 個人   | 支出 | 午餐 |        | 1   | 2026-11-10 |
        | 個人   | 支出 | 午餐 | 0      | 1   | 2026-11-10 |
        | 個人   | 支出 | 午餐 | 12.5   | 1   | 2026-11-10 |
        | 個人   | 支出 | 午餐 | 120    |     | 2026-11-10 |
        | 個人   | 支出 | 午餐 | 120    | 1   |            |
        | 個人   | 支出 | 午餐 | 120    | 1   | 2026-13-01 |

  Rule: 前置（參數）- 分類必須存在且屬於所選帳本與收支

    Scenario Outline: 分類不存在或不符時操作失敗
      When 記帳者以 LIFF 新增記帳紀錄：
        | 帳本 | 收支 | 項目 | 金額 | 分類id | 日期       | 備註 |
        | 個人 | 支出 | 午餐 | 120  | <cat>  | 2026-11-10 |      |
      Then 操作失敗，violation_type 為 "<violation>"
      And 記帳紀錄應為空

      Examples:
        | cat | violation         |
        | 3   | CATEGORY_MISMATCH |
        | 5   | CATEGORY_MISMATCH |
        | 99  | NOT_FOUND         |

  Rule: 後置（狀態）- 建立記帳紀錄，來源為 LIFF表單，備註可空

    Scenario Outline: 表單記帳成功
      When 記帳者以 LIFF 新增記帳紀錄：
        | 帳本     | 收支   | 項目   | 金額     | 分類id | 日期   | 備註   |
        | <ledger> | <type> | <item> | <amount> | <cat>  | <date> | <note> |
      Then 操作成功
      And 記帳紀錄應為：
        | 帳本     | 收支   | 項目   | 金額     | 分類      | 日期   | 備註   | 來源     |
        | <ledger> | <type> | <item> | <amount> | <catName> | <date> | <note> | LIFF表單 |

      Examples:
        | ledger | type | item   | amount | cat | catName | date       | note   |
        | 個人   | 支出 | 午餐   | 120    | 1   | 餐飲    | 2026-11-10 |        |
        | 個人   | 收入 | 十月薪 | 50000  | 3   | 薪資    | 2026-10-31 | 補記   |
        | 公司   | 支出 | 影印紙 | 1      | 5   | 文具    | 2026-11-12 | 最小額 |
