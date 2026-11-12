# Execution Plan — LINE 記帳（Greenfield）

## 概覽
| 類型 | 數量 |
|------|------|
| Create | 全部（3 activities、14 features、4 句型.md、系統抽象.md、2 actors、erm.dbml、api.yml） |
| Modify | 0 |
| Delete | 0 |

## Phase 01: Discovery
| 操作 | 目標 | 說明 |
|------|------|------|
| create | activities/LINE快速記帳.mmd | 加好友白名單、文字記帳、分類按鈕、刪除按鈕 |
| create | activities/LIFF帳目維護.mmd | 列表、表單記帳、編輯、刪除、分類管理 |
| create | activities/統計查詢.mmd | 月度文字摘要、LIFF 圖表 |
| create | features/access/加入好友.feature | LINE follow event |
| create | features/transaction/*.feature (8) | 文字記帳、選分類、請求刪除、確認刪除、表單記帳、編輯、刪除、列表 |
| create | features/category/*.feature (3) | 查詢、新增、刪除分類 |
| create | features/report/*.feature (2) | 月度文字摘要、月度圖表 |

## Phase 02: Entity Modeling
| 操作 | 目標 | 說明 |
|------|------|------|
| create | specs/entity/erm.dbml | enums ledger/entry_type/entry_source；tables categories、category_keywords、transactions、postback_tokens |

## Phase 03: BDD Analysis
| 操作 | 目標 | 說明 |
|------|------|------|
| create | access/ transaction/ category/ report/ | 系統抽象.md + 各 domain 句型.md + Examples |

## Phase 04: API Contract
| 操作 | 目標 | 說明 |
|------|------|------|
| create | POST /webhook/line | LINE webhook（follow / message / postback），簽章驗證 |
| create | /api/transactions (GET/POST/PUT/DELETE) | LIFF，Bearer LIFF ID token |
| create | /api/categories (GET/POST/DELETE) | LIFF |
| create | GET /api/reports/monthly | LIFF 圖表 |

## Phase 05-07: Implementation
| 操作 | 目標 | 說明 |
|------|------|------|
| red-green-refactor | features/**/*.feature | Node.js 20 + TypeScript + Prisma + PostgreSQL 後端 TDD |
| build | LIFF 前端 | 表單、列表、分類管理、圖表頁 |
| infra | 部署 | GitHub Actions → SSH → VPS；加入既有共用 Docker Compose（共用 Caddy 反代 + HTTPS、共用 PostgreSQL 但獨立 database/user、網路隔離）；不自帶 Caddy/Postgres；備份由共用基礎設施負責 |
| setup | LINE 設定 | Messaging API channel、LIFF app、Rich Menu（本月摘要/上月摘要/記帳表單/圖表/分類管理） |

## 狀態（2026-11-12）
- Phase 01-04 規格已完成：CiC = 0、無 @ignore、Gherkin / DBML / OpenAPI 皆可解析
- 下一步：交接 planner 規劃 Phase 05-07
- 2026-11-12：Phase 05–07 實作計劃完成 → `plans/line-accounting/implementation-plan.md`（10 階段 P0–P9）、`test-strategy.md`、`deployment-runbook.md`；待確認 Q-1（Node 版本）、Q-2（共用環境盤點）、Q-3（子網域），下一步交接 tdd-coordinator
