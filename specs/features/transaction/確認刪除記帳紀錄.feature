@command
Feature: 確認刪除記帳紀錄
  作為 記帳者
  我要 在「確定刪除？」提示中選擇確定或取消
  以便 刪除記錯的紀錄，或放棄刪除

  # 觸發：LINE webhook postback 事件，data：action=delete_confirm&id=<id> 或 action=delete_cancel&id=<id>

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
    And 系統中有以下記帳紀錄：
      | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
      | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

  Rule: 前置（狀態）- LINE userId 不在白名單時不刪除也不回覆

    Example: 非白名單使用者確認刪除時紀錄保留
      When "U-stranger" 點擊 postback "action=delete_confirm&id=10"
      Then 不回覆任何訊息
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

  Rule: 前置（狀態）- 紀錄必須存在

    Example: 重複確認刪除已刪除的紀錄時回覆提示
      When "U-owner" 點擊 postback "action=delete_confirm&id=99"
      Then 回覆訊息應為 "此紀錄已不存在"

  Rule: 後置（狀態）- 選擇「確定」時紀錄被刪除

    Example: 確定刪除後紀錄消失並回覆已刪除
      When "U-owner" 點擊 postback "action=delete_confirm&id=10"
      Then 回覆訊息應為 "已刪除：午餐 120 元（2026-11-12）"
      And 記帳紀錄應為空

  Rule: 後置（狀態）- 選擇「取消」時紀錄保留

    Example: 取消刪除後紀錄保留並回覆已取消
      When "U-owner" 點擊 postback "action=delete_cancel&id=10"
      Then 回覆訊息應為 "已取消刪除"
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |
