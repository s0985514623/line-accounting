/**
 * 多個資源共用的輸入驗證片段（specs/api/api.yml）。
 */
import { z } from 'zod';
import { ENTRY_TYPES, LEDGERS } from '../../domain/enums';

export const LedgerSchema = z.enum(LEDGERS);
export const EntryTypeSchema = z.enum(ENTRY_TYPES);

/** 'YYYY-MM'（月份 01–12），與 api.yml month 參數的 pattern 一致。 */
export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** path 參數 id：只接受十進位數字字串（範圍由 service 判斷，超出視為不存在）。 */
export const RecordIdParamSchema = z.object({
  id: z
    .string()
    .regex(/^\d{1,10}$/)
    .transform(Number),
});
