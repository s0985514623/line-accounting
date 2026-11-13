/**
 * 每月固定收支 API（specs/api/api.yml）：
 *  GET    /api/recurring                           → 200 { items: RecurringEntry[] }
 *  POST   /api/recurring                           → 201 RecurringEntry
 *  PUT    /api/recurring/{id}                      → 200 RecurringEntry
 *  DELETE /api/recurring/{id}                      → 204
 *  GET    /api/recurring/occurrences               → 200 { items: RecurringOccurrence[] }（待確認，到期日舊到新）
 *  POST   /api/recurring/occurrences/{id}/confirm  → 201 Transaction（source = liff_form）
 *  POST   /api/recurring/occurrences/{id}/skip     → 204
 * 已處理過的一期 → 409 OCCURRENCE_RESOLVED；不存在 → 404 NOT_FOUND。
 */
import { Router } from 'express';
import { DomainError } from '../../domain/errors';
import type { RecurringService } from '../../services/recurring-service';
import { asyncHandler } from '../async-handler';
import { toRecurringEntryDto, toRecurringOccurrenceDto, toTransactionDto } from '../mappers';
import { parseInput } from '../schemas/parse-input';
import {
  ConfirmOccurrenceInputSchema,
  RecurringEntryInputSchema,
  RecurringIdParamSchema,
} from '../schemas/recurring';

const OCCURRENCE_NOT_FOUND_MESSAGE = '此期固定收支不存在';
const OCCURRENCE_RESOLVED_MESSAGE = '此期已處理過';

function throwOccurrenceFailure(kind: 'notFound' | 'alreadyResolved'): never {
  if (kind === 'notFound') throw new DomainError('NOT_FOUND', OCCURRENCE_NOT_FOUND_MESSAGE);
  throw new DomainError('OCCURRENCE_RESOLVED', OCCURRENCE_RESOLVED_MESSAGE);
}

export function createRecurringRouter(recurring: RecurringService): Router {
  const router = Router();

  router.get(
    '/recurring',
    asyncHandler(async (_req, res) => {
      const items = await recurring.listEntries();
      res.status(200).json({ items: items.map(toRecurringEntryDto) });
    }),
  );

  router.post(
    '/recurring',
    asyncHandler(async (req, res) => {
      const body = parseInput(RecurringEntryInputSchema, req.body);
      const created = await recurring.createEntry(body);
      res.status(201).json(toRecurringEntryDto(created));
    }),
  );

  router.get(
    '/recurring/occurrences',
    asyncHandler(async (_req, res) => {
      const items = await recurring.listPendingOccurrences();
      res.status(200).json({ items: items.map(toRecurringOccurrenceDto) });
    }),
  );

  router.post(
    '/recurring/occurrences/:id/confirm',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(RecurringIdParamSchema, req.params);
      const body = parseInput(ConfirmOccurrenceInputSchema, req.body ?? {});
      const result = await recurring.confirmOccurrence(id, {
        ...(body.amount !== undefined && { amount: body.amount }),
        source: 'liff_form',
      });
      if (result.kind !== 'confirmed') throwOccurrenceFailure(result.kind);
      res.status(201).json(toTransactionDto(result.transaction));
    }),
  );

  router.post(
    '/recurring/occurrences/:id/skip',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(RecurringIdParamSchema, req.params);
      const result = await recurring.skipOccurrence(id);
      if (result.kind !== 'skipped') throwOccurrenceFailure(result.kind);
      res.status(204).end();
    }),
  );

  router.put(
    '/recurring/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(RecurringIdParamSchema, req.params);
      const body = parseInput(RecurringEntryInputSchema, req.body);
      const updated = await recurring.updateEntry(id, body);
      res.status(200).json(toRecurringEntryDto(updated));
    }),
  );

  router.delete(
    '/recurring/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(RecurringIdParamSchema, req.params);
      await recurring.deleteEntry(id);
      res.status(204).end();
    }),
  );

  return router;
}
