/**
 * 記帳 API（specs/api/api.yml）：
 *  GET    /api/transactions?month=&ledger=  → 200 { items: Transaction[] }（日期新到舊、同日 id 大到小）
 *  POST   /api/transactions                 → 201 Transaction（source = liff_form）
 *  POST   /api/transactions/batch           → 201 { items: Transaction[] }（全部成功或全部不寫入）
 *  PUT    /api/transactions/{id}            → 200 Transaction（全欄位更新，source 不變）
 *  DELETE /api/transactions/{id}            → 204
 * 身分驗證由上層 /api router 的 liff-auth 負責；此處只做輸入驗證與委派 service。
 */
import { Router } from 'express';
import type { TransactionService } from '../../services/transaction-service';
import { asyncHandler } from '../async-handler';
import { toTransactionDto } from '../mappers';
import { parseInput } from '../schemas/parse-input';
import {
  ListTransactionsQuerySchema,
  TransactionBatchInputSchema,
  TransactionIdParamSchema,
  TransactionInputSchema,
} from '../schemas/transaction';

export function createTransactionsRouter(transactions: TransactionService): Router {
  const router = Router();

  router.get(
    '/transactions',
    asyncHandler(async (req, res) => {
      const query = parseInput(ListTransactionsQuerySchema, req.query);
      const items = await transactions.listByMonth(query.ledger, query.month);
      res.status(200).json({ items: items.map(toTransactionDto) });
    }),
  );

  router.post(
    '/transactions',
    asyncHandler(async (req, res) => {
      const body = parseInput(TransactionInputSchema, req.body);
      const created = await transactions.createFromForm(body);
      res.status(201).json(toTransactionDto(created));
    }),
  );

  router.post(
    '/transactions/batch',
    asyncHandler(async (req, res) => {
      const body = parseInput(TransactionBatchInputSchema, req.body);
      const created = await transactions.createManyFromForm(body.items);
      res.status(201).json({ items: created.map(toTransactionDto) });
    }),
  );

  router.put(
    '/transactions/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(TransactionIdParamSchema, req.params);
      const body = parseInput(TransactionInputSchema, req.body);
      const updated = await transactions.updateFromForm(id, body);
      res.status(200).json(toTransactionDto(updated));
    }),
  );

  router.delete(
    '/transactions/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(TransactionIdParamSchema, req.params);
      await transactions.deleteFromForm(id);
      res.status(204).end();
    }),
  );

  return router;
}
