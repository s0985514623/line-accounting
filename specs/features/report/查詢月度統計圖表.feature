@query
Feature: 查詢月度統計圖表
  作為 記帳者
  我要 在 LIFF 圖表頁查看指定月份、指定帳本的統計
  以便 用圖表（收支長條 + 支出分類圓餅）了解花費結構

  # 觸發：GET /api/reports/monthly?month=YYYY-MM&ledger=personal|company
  # 未帶參數時：month = 本月（Asia/Taipei），ledger = 個人
  # 佔比規則同「查詢月度文字摘要」

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And LIFF 請求身分為 "U-owner"
    And 今天為 "2026-11-12"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱     | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲     | 否       |
      | 2  | 個人 | 支出 | 其他     | 是       |
      | 3  | 個人 | 收入 | 薪資     | 否       |
      | 4  | 個人 | 收入 | 獎金     | 否       |
      | 5  | 公司 | 支出 | 文具     | 否       |
      | 7  | 公司 | 收入 | 營業收入 | 否       |
    And 系統中有以下記帳紀錄：
      | id | 帳本 | 收支 | 項目     | 金額  | 分類     | 日期       | 備註 | 來源     |
      | 10 | 個人 | 支出 | 午餐     | 120   | 餐飲     | 2026-11-12 |      | LINE文字 |
      | 11 | 個人 | 支出 | 晚餐     | 180   | 餐飲     | 2026-11-03 |      | LINE文字 |
      | 12 | 個人 | 支出 | 雜支     | 100   | 其他     | 2026-11-01 |      | LINE文字 |
      | 13 | 個人 | 收入 | 薪資     | 50000 | 薪資     | 2026-11-05 |      | LIFF表單 |
      | 14 | 個人 | 支出 | 宵夜     | 90    | 餐飲     | 2026-10-31 |      | LINE文字 |
      | 15 | 公司 | 支出 | 影印紙   | 100   | 文具     | 2026-11-03 |      | LINE文字 |
      | 17 | 公司 | 收入 | 營業收入 | 30000 | 營業收入 | 2026-11-10 |      | LINE文字 |

  Rule: 前置（狀態）- LIFF ID token 必須有效，且其 userId 必須在白名單

    Scenario Outline: 身分不合法時操作失敗
      Given LIFF 請求身分為 "<identity>"
      When 記帳者以 LIFF 查詢月度統計：
        | 月份    | 帳本 |
        | 2026-11 | 個人 |
      Then 操作失敗，violation_type 為 "<violation>"

      Examples:
        | identity    | violation       |
        | U-stranger  | FORBIDDEN       |
        | (無效token) | UNAUTHENTICATED |

  Rule: 前置（參數）- 月份若提供須為合法 YYYY-MM，帳本若提供須為個人或公司

    Scenario Outline: 參數不合法時操作失敗
      When 記帳者以 LIFF 查詢月度統計：
        | 月份    | 帳本     |
        | <month> | <ledger> |
      Then 操作失敗，violation_type 為 "INVALID_ARGUMENT"

      Examples:
        | month   | ledger |
        | 2026-13 | 個人   |
        | 202611  | 個人   |
        | 2026-11 | 家庭   |

  Rule: 後置（回應）- 回傳收入合計、支出合計、結餘；未帶參數時為本月個人帳本

    Scenario Outline: 查詢月度收支合計
      When 記帳者以 LIFF 查詢月度統計：
        | 月份         | 帳本          |
        | <monthParam> | <ledgerParam> |
      Then 月度統計結果應為：
        | 帳本     | 月份    | 收入合計 | 支出合計  | 結餘      |
        | <ledger> | <month> | <income> | <expense> | <balance> |

      Examples:
        | monthParam | ledgerParam | ledger | month   | income | expense | balance |
        | 2026-11    | 個人        | 個人   | 2026-11 | 50000  | 400     | 49600   |
        | 2026-10    | 個人        | 個人   | 2026-10 | 0      | 90      | -90     |
        | 2026-11    | 公司        | 公司   | 2026-11 | 30000  | 100     | 29900   |
        |            |             | 個人   | 2026-11 | 50000  | 400     | 49600   |

  Rule: 後置（回應）- 回傳支出各分類金額與佔比，依金額由大到小

    Example: 個人本月支出分類佔比
      When 記帳者以 LIFF 查詢月度統計：
        | 月份    | 帳本 |
        | 2026-11 | 個人 |
      Then 支出分類佔比應為：
        | 分類 | 金額 | 佔比  |
        | 餐飲 | 300  | 75.0% |
        | 其他 | 100  | 25.0% |

    Example: 沒有支出的月份回傳空的分類佔比
      When 記帳者以 LIFF 查詢月度統計：
        | 月份    | 帳本 |
        | 2026-09 | 公司 |
      Then 支出分類佔比應為空

  Rule: 後置（回應）- 回傳收入各分類金額與佔比，依金額由大到小

    Example: 個人本月收入分類佔比
      Given 系統中有以下記帳紀錄：
        | id | 帳本 | 收支 | 項目 | 金額  | 分類 | 日期       | 備註 | 來源     |
        | 18 | 個人 | 收入 | 獎金 | 10000 | 獎金 | 2026-11-08 |      | LIFF表單 |
      When 記帳者以 LIFF 查詢月度統計：
        | 月份    | 帳本 |
        | 2026-11 | 個人 |
      Then 收入分類佔比應為：
        | 分類 | 金額  | 佔比  |
        | 薪資 | 50000 | 83.3% |
        | 獎金 | 10000 | 16.7% |
      And 支出分類佔比應為：
        | 分類 | 金額 | 佔比  |
        | 餐飲 | 300  | 75.0% |
        | 其他 | 100  | 25.0% |

    Example: 沒有收入的月份不列收入分類佔比
      When 記帳者以 LIFF 查詢月度統計：
        | 月份    | 帳本 |
        | 2026-09 | 公司 |
      Then 收入分類佔比應為空
