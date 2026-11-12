@command
Feature: 選擇分類完成記帳
  作為 記帳者
  我要 在文字記帳對應不到分類時點選分類按鈕
  以便 完成記帳，並讓系統記住這個項目下次自動歸類

  # 觸發：LINE webhook postback 事件（POST /webhook/line）
  # postback data：action=pick&token=<token>&ledger=<personal|company>&type=<expense|income>&item=<項目>&amount=<金額>&date=<YYYY-MM-DD>&note=<備註>&categoryId=<id>

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
      | 2  | 個人 | 支出 | 其他 | 是       |
      | 5  | 公司 | 支出 | 文具 | 否       |

  Rule: 前置（狀態）- LINE userId 不在白名單時不記帳也不回覆

    Example: 非白名單使用者點分類按鈕時不記帳
      When "U-stranger" 點擊 postback "action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=&categoryId=1"
      Then 不回覆任何訊息
      And 記帳紀錄應為空

  Rule: 前置（狀態）- 同一個分類按鈕 token 只能使用一次

    Example: 重複點擊已使用的分類按鈕時不重複記帳
      Given 系統中有以下已使用的分類按鈕 token：
        | token |
        | tk1   |
      When "U-owner" 點擊 postback "action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=&categoryId=1"
      Then 回覆訊息應為 "此筆已記帳"
      And 記帳紀錄應為空

  Rule: 前置（參數）- 選擇的分類必須存在且屬於該帳本與該收支類型

    Scenario Outline: 分類不存在或不符時操作失敗
      When "U-owner" 點擊 postback "action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=&categoryId=<categoryId>"
      Then 回覆訊息應為 "<message>"
      And 記帳紀錄應為空

      Examples:
        | categoryId | message                |
        | 5          | 分類不符，請重新記帳   |
        | 99         | 分類不存在，請重新記帳 |

  Rule: 後置（狀態）- 以選擇的分類建立記帳紀錄，並將項目學習為該分類的關鍵字

    Example: 選擇一般分類後記帳並學習關鍵字
      When "U-owner" 點擊 postback "action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=便利商店&categoryId=1"
      Then 記帳紀錄應為：
        | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註     | 來源     |
        | 個人 | 支出 | 早餐 | 80   | 餐飲 | 2026-11-12 | 便利商店 | LINE文字 |
      And 分類關鍵字應為：
        | 帳本 | 收支 | 關鍵字 | 分類 |
        | 個人 | 支出 | 早餐   | 餐飲 |

  Rule: 後置（狀態）- 選擇「其他」分類時記帳但不學習關鍵字

    Example: 選擇其他分類後記帳但不新增關鍵字
      When "U-owner" 點擊 postback "action=pick&token=tk1&ledger=personal&type=expense&item=雜支&amount=50&date=2026-11-12&note=&categoryId=2"
      Then 記帳紀錄應為：
        | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 個人 | 支出 | 雜支 | 50   | 其他 | 2026-11-12 |      | LINE文字 |
      And 分類關鍵字應為空

  Rule: 後置（回應）- 記帳成功回覆記帳摘要並附「刪除」按鈕

    Example: 選擇分類記帳成功後回覆摘要與刪除按鈕
      When "U-owner" 點擊 postback "action=pick&token=tk1&ledger=personal&type=expense&item=早餐&amount=80&date=2026-11-12&note=&categoryId=1"
      Then 回覆訊息應為 "已記帳｜個人｜支出｜早餐 80 元｜分類：餐飲｜2026-11-12"
      And 回覆的按鈕應為：
        | 標籤 | postback                      |
        | 刪除 | action=delete&id=$記帳紀錄.id |
