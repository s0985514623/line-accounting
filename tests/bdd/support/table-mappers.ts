/**
 * Data Table 中文值 ↔ 內部值對照，以及各種表格的「正規化」比對工具。
 *
 * 比對策略：預期（Data Table）與實際（DB / API）都轉成「欄位標題 → 字串」的 canonical 物件，
 * 再以 deepStrictEqual 比對；只比對 Data Table 實際出現的欄位。
 */

// ---- 值對照 ----------------------------------------------------------------------------------

const LEDGER: Record<string, string> = { 個人: 'personal', 公司: 'company' };
const ENTRY_TYPE: Record<string, string> = { 支出: 'expense', 收入: 'income' };
const SOURCE: Record<string, string> = { LINE文字: 'line_text', LIFF表單: 'liff_form' };
const FALLBACK: Record<string, string> = { 是: 'true', 否: 'false' };

/** `"  "`（含引號）→ 去掉引號後的字串（兩個空白）；其餘原樣。 */
export function unquote(raw: string): string {
  const m = /^"(.*)"$/s.exec(raw);
  return m ? (m[1] as string) : raw;
}

function mapOrThrow(table: Record<string, string>, label: string, raw: string): string {
  const text = unquote(raw);
  const mapped = table[text];
  if (mapped === undefined) {
    throw new Error(`未知的${label}：「${text}」（可用：${Object.keys(table).join('、')}）`);
  }
  return mapped;
}

export const mapLedger = (raw: string): string => mapOrThrow(LEDGER, '帳本', raw);
export const mapEntryType = (raw: string): string => mapOrThrow(ENTRY_TYPE, '收支', raw);
export const mapSource = (raw: string): string => mapOrThrow(SOURCE, '來源', raw);
export const mapFallback = (raw: string): string => mapOrThrow(FALLBACK, '其他分類', raw);

/** 內部值 → 中文（供失敗訊息閱讀）。 */
export function reverseLabel(internal: string): string {
  for (const table of [LEDGER, ENTRY_TYPE, SOURCE, FALLBACK]) {
    for (const [zh, value] of Object.entries(table)) {
      if (value === internal) return zh;
    }
  }
  return internal;
}

/** 空白儲存格 → null；否則去引號。 */
export function emptyToNull(raw: string | undefined): string | null {
  if (raw === undefined || raw === '') return null;
  return unquote(raw);
}

/** 金額儲存格：符合數字 → Number（12.5 送 12.5、0 送 0）；空 → undefined（省略）；其餘保留原字串。 */
export function amountCell(raw: string | undefined): number | string | undefined {
  if (raw === undefined || raw === '') return undefined;
  const text = unquote(raw);
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

// ---- LIFF 請求欄位（W3–W10 使用；空白儲存格 → 省略，備註空白 → null） ---------------------------

const LIFF_FIELD: Record<string, string> = {
  帳本: 'ledger',
  收支: 'entryType',
  項目: 'item',
  金額: 'amount',
  分類id: 'categoryId',
  日期: 'occurredOn',
  備註: 'note',
  月份: 'month',
  名稱: 'name',
};

function liffField(header: string): string {
  const field = LIFF_FIELD[header];
  if (!field) throw new Error(`未知的 LIFF 欄位：${header}`);
  return field;
}

/** 將一列 Data Table 轉成 LIFF 請求 JSON body（空白省略；備註空白 → null）。 */
export function rowToLiffBody(row: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [header, raw] of Object.entries(row)) {
    const field = liffField(header);
    if (field === 'note') {
      body.note = emptyToNull(raw);
    } else if (raw === '') {
      continue;
    } else if (field === 'ledger') {
      body.ledger = mapLedger(raw);
    } else if (field === 'entryType') {
      body.entryType = mapEntryType(raw);
    } else if (field === 'amount') {
      body.amount = amountCell(raw);
    } else if (field === 'categoryId') {
      body.categoryId = Number(raw);
    } else {
      body[field] = unquote(raw);
    }
  }
  return body;
}

/** 將一列 Data Table 轉成 LIFF 查詢參數（空白不帶 query param）。 */
export function rowToLiffQuery(row: Record<string, string>): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [header, raw] of Object.entries(row)) {
    const field = liffField(header);
    if (raw === '') continue;
    if (field === 'ledger') query.ledger = mapLedger(raw);
    else if (field === 'entryType') query.entryType = mapEntryType(raw);
    else query[field] = unquote(raw);
  }
  return query;
}

// ---- canonical 正規化 ------------------------------------------------------------------------

export type Canon = Record<string, string>;

export type TableKind = 'transaction' | 'category' | 'keyword';

/** 依表頭判斷表格種類。 */
export function detectKind(headers: string[]): TableKind {
  if (headers.includes('名稱') || headers.includes('其他分類')) return 'category';
  if (headers.includes('關鍵字')) return 'keyword';
  return 'transaction';
}

function normalizeNumber(raw: string, header: string): string {
  const text = unquote(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`欄位「${header}」必須為數字，實際為：${raw}`);
  }
  return String(Number(text));
}

/** 預期（Data Table 一列）→ canonical。 */
export function canonFromExpected(headers: string[], row: Record<string, string>): Canon {
  const out: Canon = {};
  for (const header of headers) {
    const raw = row[header] ?? '';
    switch (header) {
      case 'id':
      case '金額':
        out[header] = normalizeNumber(raw, header);
        break;
      case '帳本':
        out[header] = mapLedger(raw);
        break;
      case '收支':
        out[header] = mapEntryType(raw);
        break;
      case '來源':
        out[header] = mapSource(raw);
        break;
      case '其他分類':
        out[header] = mapFallback(raw);
        break;
      default:
        out[header] = unquote(raw);
    }
  }
  return out;
}

const DB_COLUMN: Record<string, string> = {
  id: 'id',
  帳本: 'ledger',
  收支: 'entry_type',
  項目: 'item',
  金額: 'amount',
  分類: 'category',
  日期: 'occurred_on',
  備註: 'note',
  來源: 'source',
  名稱: 'name',
  其他分類: 'is_fallback',
  關鍵字: 'keyword',
};

/** DB 列（snake_case 欄位，SQL 見 steps/common/state.steps.ts）→ canonical。 */
export function canonFromDb(headers: string[], row: Record<string, unknown>): Canon {
  const out: Canon = {};
  for (const header of headers) {
    const column = DB_COLUMN[header];
    if (!column) throw new Error(`未知的欄位：${header}`);
    const value = row[column];
    out[header] = value === null || value === undefined ? '' : String(value);
  }
  return out;
}

const API_FIELD: Record<string, string> = {
  id: 'id',
  帳本: 'ledger',
  收支: 'entryType',
  項目: 'item',
  金額: 'amount',
  分類: 'categoryName',
  日期: 'occurredOn',
  備註: 'note',
  來源: 'source',
  名稱: 'name',
  其他分類: 'isFallback',
};

/** API 回應物件（camelCase，見 specs/api/api.yml）→ canonical。 */
export function canonFromApi(headers: string[], item: Record<string, unknown>): Canon {
  const out: Canon = {};
  for (const header of headers) {
    const field = API_FIELD[header];
    if (!field) throw new Error(`API 結果不支援的欄位：${header}`);
    const value = item[field];
    out[header] = value === null || value === undefined ? '' : String(value);
  }
  return out;
}

/** 失敗時的可讀描述：以中文標籤列出每一列。 */
export function describeRows(rows: Canon[]): string {
  if (rows.length === 0) return '（無資料）';
  return rows
    .map((r) =>
      Object.entries(r)
        .map(([k, v]) => `${k}=${reverseLabel(v)}`)
        .join(' | '),
    )
    .join('\n');
}
