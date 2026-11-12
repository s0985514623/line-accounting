@query
Feature: 查詢記帳紀錄列表
  作為 記帳者
  我要 在 LIFF 依月份與帳本查看記帳紀錄
  以便 檢查、編輯或刪除紀錄

  # 觸發：GET /api/transactions?month=YYYY-MM&ledger=personal|company
  # 排序：日期新到舊，同日期 id 大到小

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 3  | 個人 | 收入 | 薪資 | 否       |
      | 5  | 公司 | 支出 | 文具 | 否       |
    And 系統中有以下記帳紀錄：
      | id | 帳本 | 收支 | 項目   | 金額  | 分類 | 日期       | 備註   | 來源     |
      | 10 | 個人 | 支出 | 午餐   | 120   | 餐飲 | 2026-11-12 |        | LINE文字 |
      | 11 | 個人 | 支出 | 晚餐   | 200   | 餐飲 | 2026-11-12 | 和朋友 | LINE文字 |
      | 12 | 個人 | 收入 | 薪資   | 50000 | 薪資 | 2026-11-05 |        | LIFF表單 |
      | 13 | 個人 | 支出 | 宵夜   | 90    | 餐飲 | 2026-10-31 |        | LINE文字 |
      | 14 | 公司 | 支出 | 影印紙 | 300   | 文具 | 2026-11-03 |        | LINE文字 |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 查詢記帳紀錄列表：
        | 月份    | 帳本 |
        | 2026-11 | 個人 |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（參數）- 月份（YYYY-MM）與帳本為必填

    Scenario Outline: 月份或帳本不合法時操作失敗
      When 記帳者以 LIFF 查詢記帳紀錄列表：
        | 月份    | 帳本     |
        | <month> | <ledger> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | month   | ledger |
        |         | 個人   |
        | 2026-13 | 個人   |
        | 2026-11 |        |

  Rule: 後置（回應）- 只回傳指定月份與帳本的紀錄，日期新到舊、同日 id 大到小

    Example: 查詢 2026-11 個人帳本
      When 記帳者以 LIFF 查詢記帳紀錄列表：
        | 月份    | 帳本 |
        | 2026-11 | 個人 |
      Then 查詢結果應為：
        | id | 帳本 | 收支 | 項目 | 金額  | 分類 | 日期       | 備註   | 來源     |
        | 11 | 個人 | 支出 | 晚餐 | 200   | 餐飲 | 2026-11-12 | 和朋友 | LINE文字 |
        | 10 | 個人 | 支出 | 午餐 | 120   | 餐飲 | 2026-11-12 |        | LINE文字 |
        | 12 | 個人 | 收入 | 薪資 | 50000 | 薪資 | 2026-11-05 |        | LIFF表單 |

    Example: 查詢 2026-11 公司帳本
      When 記帳者以 LIFF 查詢記帳紀錄列表：
        | 月份    | 帳本 |
        | 2026-11 | 公司 |
      Then 查詢結果應為：
        | id | 帳本 | 收支 | 項目   | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 14 | 公司 | 支出 | 影印紙 | 300  | 文具 | 2026-11-03 |      | LINE文字 |

    Example: 查詢沒有紀錄的月份時回傳空清單
      When 記帳者以 LIFF 查詢記帳紀錄列表：
        | 月份    | 帳本 |
        | 2026-09 | 個人 |
      Then 查詢結果應為空
