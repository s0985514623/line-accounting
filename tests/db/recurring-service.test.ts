/**
 * DB 整合測試：每月固定收支（RecurringService + 分類刪除連動 + 排程推播）。
 *
 * 執行：TEST_DATABASE_URL=postgresql://test:test@localhost:5434/test npx vitest run tests/db
 * 隔離：獨立 PostgreSQL schema，結束後 DROP。
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LineMessage, LinePushGateway } from '../../src/ports/line-reply-gateway';
import { RecurringScheduler } from '../../src/scheduler/recurring-scheduler';
import { CategoryService } from '../../src/services/category-service';
import { RecurringService, type RecurringEntryInput } from '../../src/services/recurring-service';
import {
  acquireTestDatabase,
  createPrismaClient,
  runMigrateDeploy,
  truncateAll,
  withSchema,
  type TestDatabase,
} from '../bdd/support/db';

let database: TestDatabase;
let admin: PrismaClient;
let prisma: PrismaClient;
let schemaName: string;

/** 可調整的固定時鐘。 */
const clock = { current: new Date('2026-11-13T02:00:00Z'), now: () => clock.current };

function setTaipeiTime(isoLocal: string): void {
  clock.current = new Date(`${isoLocal}+08:00`);
}

beforeAll(async () => {
  database = await acquireTestDatabase();
  schemaName = `t_${randomBytes(6).toString('hex')}`;
  const url = withSchema(database.url, schemaName);
  runMigrateDeploy(url);
  admin = createPrismaClient(database.url);
  prisma = createPrismaClient(url);
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (admin) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await admin.$disconnect();
  }
  await database?.stop();
});

let rentCategoryId: number;
let fallbackCategoryId: number;
let salaryCategoryId: number;

beforeEach(async () => {
  await truncateAll(prisma);
  setTaipeiTime('2026-11-13T10:00:00');
  fallbackCategoryId = (
    await prisma.category.create({
      data: { ledger: 'personal', entryType: 'expense', name: '其他', isFallback: true },
    })
  ).id;
  rentCategoryId = (
    await prisma.category.create({
      data: { ledger: 'personal', entryType: 'expense', name: '居住' },
    })
  ).id;
  salaryCategoryId = (
    await prisma.category.create({
      data: { ledger: 'personal', entryType: 'income', name: '薪資' },
    })
  ).id;
});

function service(): RecurringService {
  return new RecurringService({ prisma, clock });
}

function rent(overrides: Partial<RecurringEntryInput> = {}): RecurringEntryInput {
  return {
    ledger: 'personal',
    entryType: 'expense',
    item: '房租',
    amount: 15000,
    categoryId: rentCategoryId,
    dayOfMonth: 5,
    note: null,
    active: true,
    ...overrides,
  };
}

describe('規則 CRUD', () => {
  it('新增：本月到期日已過 → 下個月開始', async () => {
    const created = await service().createEntry(rent({ dayOfMonth: 5 }));
    expect(created).toMatchObject({ item: '房租', categoryName: '居住', nextDueOn: '2026-12-05' });
  });

  it('新增：今天到期 → 今天', async () => {
    const created = await service().createEntry(rent({ dayOfMonth: 13 }));
    expect(created.nextDueOn).toBe('2026-11-13');
  });

  it('新增：分類與收支不符 → CATEGORY_MISMATCH', async () => {
    await expect(
      service().createEntry(rent({ categoryId: salaryCategoryId })),
    ).rejects.toMatchObject({ violationType: 'CATEGORY_MISMATCH' });
  });

  it('編輯：改日期時跳過已產生過的月份', async () => {
    const created = await service().createEntry(rent({ dayOfMonth: 10 }));
    setTaipeiTime('2026-12-10T10:00:00');
    await service().generateDue();
    // 12/10 已產生；改成 20 號 → 12 月已有一期，下一期為 1/20
    const updated = await service().updateEntry(created.id, rent({ dayOfMonth: 20 }));
    expect(updated.nextDueOn).toBe('2027-01-20');
  });

  it('編輯：只改金額不改 nextDueOn', async () => {
    const created = await service().createEntry(rent());
    const updated = await service().updateEntry(created.id, rent({ amount: 16000 }));
    expect(updated).toMatchObject({ amount: 16000, nextDueOn: created.nextDueOn });
  });

  it('刪除不存在的規則 → NOT_FOUND', async () => {
    await expect(service().deleteEntry(999)).rejects.toMatchObject({ violationType: 'NOT_FOUND' });
  });

  it('刪除分類 → 規則改歸「其他」', async () => {
    const created = await service().createEntry(rent());
    await new CategoryService(prisma).delete(rentCategoryId);
    const [entry] = await service().listEntries();
    expect(entry).toMatchObject({ id: created.id, categoryId: fallbackCategoryId });
  });
});

describe('generateDue', () => {
  it('伺服器停機多月 → 逐月補產生，nextDueOn 推進到未來', async () => {
    await service().createEntry(rent({ dayOfMonth: 31 }));
    // 建立時 nextDueOn = 2026-11-30；跳到 2027-03-31
    setTaipeiTime('2027-03-31T10:00:00');
    await service().generateDue();
    const pending = await service().listPendingOccurrences();
    expect(pending.map((o) => o.dueOn)).toEqual([
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
    const [entry] = await service().listEntries();
    expect(entry?.nextDueOn).toBe('2027-04-30');
  });

  it('重複執行不重複產生', async () => {
    await service().createEntry(rent({ dayOfMonth: 13 }));
    await service().generateDue();
    await service().generateDue();
    expect(await service().listPendingOccurrences()).toHaveLength(1);
  });

  it('停用的規則不產生', async () => {
    await service().createEntry(rent({ dayOfMonth: 13, active: false }));
    await service().generateDue();
    expect(await service().listPendingOccurrences()).toHaveLength(0);
  });
});

describe('confirm / skip', () => {
  async function pendingOccurrenceId(): Promise<number> {
    await service().createEntry(rent({ dayOfMonth: 13, note: '11 月' }));
    await service().generateDue();
    const [occurrence] = await service().listPendingOccurrences();
    if (!occurrence) throw new Error('no occurrence');
    return occurrence.id;
  }

  it('確認入帳（調整金額）→ 寫入記帳紀錄，日期為到期日', async () => {
    const id = await pendingOccurrenceId();
    const result = await service().confirmOccurrence(id, { amount: 15500, source: 'liff_form' });
    expect(result.kind).toBe('confirmed');
    if (result.kind !== 'confirmed') return;
    expect(result.transaction).toMatchObject({
      item: '房租',
      amount: 15500,
      categoryId: rentCategoryId,
      occurredOn: '2026-11-13',
      note: '11 月',
      source: 'liff_form',
    });
    expect(await service().listPendingOccurrences()).toHaveLength(0);
  });

  it('確認入帳（不改金額）→ 用本期金額', async () => {
    const id = await pendingOccurrenceId();
    const result = await service().confirmOccurrence(id, { source: 'line_text' });
    expect(result.kind === 'confirmed' && result.transaction.amount).toBe(15000);
  });

  it('同一期確認兩次 → 第二次 alreadyResolved，只有一筆記帳', async () => {
    const id = await pendingOccurrenceId();
    const [first, second] = await Promise.all([
      service().confirmOccurrence(id, { source: 'line_text' }),
      service().confirmOccurrence(id, { source: 'line_text' }),
    ]);
    expect([first.kind, second.kind].sort()).toEqual(['alreadyResolved', 'confirmed']);
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('略過 → 不寫入記帳；之後不能再確認', async () => {
    const id = await pendingOccurrenceId();
    expect((await service().skipOccurrence(id)).kind).toBe('skipped');
    expect((await service().confirmOccurrence(id, { source: 'line_text' })).kind).toBe(
      'alreadyResolved',
    );
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('不存在 → notFound', async () => {
    expect((await service().confirmOccurrence(12345, { source: 'line_text' })).kind).toBe(
      'notFound',
    );
    expect((await service().skipOccurrence(12345)).kind).toBe('notFound');
  });
});

describe('RecurringScheduler', () => {
  function stubGateway(ok = true): LinePushGateway & { calls: LineMessage[][] } {
    const calls: LineMessage[][] = [];
    return {
      calls,
      push: async (_to, messages) => {
        calls.push(messages);
        return ok;
      },
    };
  }

  function scheduler(gateway: LinePushGateway): RecurringScheduler {
    return new RecurringScheduler({
      recurring: service(),
      gateway,
      clock,
      ownerUserId: 'Uowner',
      liffId: 'liff-1',
      logger: pino({ level: 'silent' }),
    });
  }

  it('9 點前只產生不推播；9 點後推播一次', async () => {
    await service().createEntry(rent({ dayOfMonth: 13 }));
    setTaipeiTime('2026-11-13T08:30:00');
    const gateway = stubGateway();
    await scheduler(gateway).tick();
    expect(gateway.calls).toHaveLength(0);
    expect(await service().listPendingOccurrences()).toHaveLength(1);

    setTaipeiTime('2026-11-13T09:00:00');
    await scheduler(gateway).tick();
    await scheduler(gateway).tick();
    expect(gateway.calls).toHaveLength(1);
    const notice = gateway.calls[0]?.[0];
    expect(notice).toMatchObject({
      type: 'template',
      template: { text: '固定支出到期｜個人｜房租 15000 元｜分類：居住｜2026-11-13' },
    });
  });

  it('推播失敗 → 不標記，下次重試', async () => {
    await service().createEntry(rent({ dayOfMonth: 13 }));
    const failing = stubGateway(false);
    await scheduler(failing).tick();
    const ok = stubGateway();
    await scheduler(ok).tick();
    expect(ok.calls).toHaveLength(1);
  });
});
