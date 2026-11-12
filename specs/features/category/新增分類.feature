@command
Feature: 新增分類
  作為 記帳者
  我要 在 LIFF 為某帳本某收支新增分類
  以便 用自己習慣的分類記帳

  # 觸發：POST /api/categories

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 2  | 個人 | 支出 | 其他 | 是       |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 新增分類：
        | 帳本 | 收支 | 名稱 |
        | 個人 | 支出 | 寵物 |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（參數）- 帳本、收支、名稱為必填，名稱去除前後空白後不可為空

    Scenario Outline: 參數不合法時操作失敗
      When 記帳者以 LIFF 新增分類：
        | 帳本     | 收支   | 名稱   |
        | <ledger> | <type> | <name> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | ledger | type | name |
        |        | 支出 | 寵物 |
        | 個人   |      | 寵物 |
        | 個人   | 支出 |      |
        | 個人   | 支出 | "  " |

  Rule: 前置（參數）- 名稱在同帳本同收支內不可重複

    Example: 同帳本同收支已有同名分類時操作失敗
      When 記帳者以 LIFF 新增分類：
        | 帳本 | 收支 | 名稱 |
        | 個人 | 支出 | 餐飲 |
      Then 操作失敗，violation_type 為 "DUPLICATE_NAME"

  Rule: 後置（狀態）- 建立一般分類（非「其他」）；不同帳本或收支可同名

    Scenario Outline: 新增分類成功
      When 記帳者以 LIFF 新增分類：
        | 帳本     | 收支   | 名稱   |
        | <ledger> | <type> | <name> |
      Then 操作成功
      And 分類應包含：
        | 帳本     | 收支   | 名稱   | 其他分類 |
        | <ledger> | <type> | <name> | 否       |

      Examples:
        | ledger | type | name |
        | 個人   | 支出 | 寵物 |
        | 公司   | 支出 | 餐飲 |
        | 個人   | 收入 | 餐飲 |
