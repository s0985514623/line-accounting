@query
Feature: 查詢分類列表
  作為 記帳者
  我要 在 LIFF 查看某帳本某收支的分類
  以便 管理分類或在表單中選擇分類

  # 觸發：GET /api/categories?ledger=personal|company&entryType=expense|income
  # 排序：一般分類依 id 由小到大，「其他」固定排最後

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 2  | 個人 | 支出 | 其他 | 是       |
      | 3  | 個人 | 收入 | 薪資 | 否       |
      | 5  | 公司 | 支出 | 文具 | 否       |
      | 9  | 個人 | 支出 | 寵物 | 否       |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 查詢分類列表：
        | 帳本 | 收支 |
        | 個人 | 支出 |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（參數）- 帳本與收支為必填

    Scenario Outline: 缺少帳本或收支時操作失敗
      When 記帳者以 LIFF 查詢分類列表：
        | 帳本     | 收支   |
        | <ledger> | <type> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | ledger | type |
        |        | 支出 |
        | 個人   |      |

  Rule: 後置（回應）- 回傳指定帳本與收支的分類，「其他」排最後

    Example: 查詢個人支出分類
      When 記帳者以 LIFF 查詢分類列表：
        | 帳本 | 收支 |
        | 個人 | 支出 |
      Then 查詢結果應為：
        | id | 帳本 | 收支 | 名稱 | 其他分類 |
        | 1  | 個人 | 支出 | 餐飲 | 否       |
        | 9  | 個人 | 支出 | 寵物 | 否       |
        | 2  | 個人 | 支出 | 其他 | 是       |
