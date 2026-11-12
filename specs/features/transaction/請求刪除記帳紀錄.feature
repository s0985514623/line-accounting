@query
Feature: 請求刪除記帳紀錄
  作為 記帳者
  我要 點記帳成功訊息上的「刪除」按鈕
  以便 先看到確認提示，避免誤刪

  # 觸發：LINE webhook postback 事件，data：action=delete&id=<transactionId>
  # 本操作不改變系統狀態，只回覆確認按鈕

  Background:
    Given 白名單 LINE userId 為 "U-owner"
    And 系統中有以下分類：
      | id | 帳本 | 收支 | 名稱 | 其他分類 |
      | 1  | 個人 | 支出 | 餐飲 | 否       |
    And 系統中有以下記帳紀錄：
      | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
      | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |

  Rule: 前置（狀態）- LINE userId 不在白名單時不回覆

    Example: 非白名單使用者點刪除按鈕時不回覆
      When "U-stranger" 點擊 postback "action=delete&id=10"
      Then 不回覆任何訊息

  Rule: 前置（狀態）- 紀錄必須存在

    Example: 紀錄已不存在時回覆提示
      When "U-owner" 點擊 postback "action=delete&id=99"
      Then 回覆訊息應為 "此紀錄已不存在"

  Rule: 後置（回應）- 回覆「確定刪除？」與確定/取消按鈕，紀錄不變

    Example: 點刪除按鈕後收到確認提示且紀錄保留
      When "U-owner" 點擊 postback "action=delete&id=10"
      Then 回覆訊息應為 "確定刪除？午餐 120 元（2026-11-12）"
      And 回覆的按鈕應為：
        | 標籤 | postback                    |
        | 確定 | action=delete_confirm&id=10 |
        | 取消 | action=delete_cancel&id=10  |
      And 記帳紀錄應為：
        | id | 帳本 | 收支 | 項目 | 金額 | 分類 | 日期       | 備註 | 來源     |
        | 10 | 個人 | 支出 | 午餐 | 120  | 餐飲 | 2026-11-12 |      | LINE文字 |
