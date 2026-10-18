import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { reconcileTransactions } from '#server/accounts/sync';
import * as db from '#server/db';

import {
  parseActivoBankXlsx,
  toActivoBankXlsxStatementRows,
} from './actuynab-activobank-xlsx';
import {
  createSyntheticActivoBankXlsx,
  SYNTHETIC_ACTIVOBANK_XLSX_TRANSACTIONS,
} from './actuynab-activobank-xlsx.fixture';
import {
  ACTIVOBANK_XLSX_FIELDS,
  prepareBankImport,
} from './actuynab-bank-import';
import { parseFile } from './parse-file';

type ParsedImportTransaction = {
  amount_minor?: number;
  date: string;
  imported_id?: string;
  imported_payee?: string;
  notes?: string | null;
  payee_name?: string;
  source_skip?: boolean;
};

let fixtureDirectory: string;

beforeEach(async () => {
  await global.emptyDatabase()();
  await db.insertAccount({ id: 'activo', name: 'Synthetic Activo' });
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'actuynab-xlsx-'));
});

afterEach(async () => {
  await rm(fixtureDirectory, { force: true, recursive: true });
});

async function parseFixture(
  buffer: Uint8Array,
): Promise<ParsedImportTransaction[]> {
  const filepath = join(fixtureDirectory, 'synthetic-activobank.xlsx');
  await writeFile(filepath, buffer);
  const result = await parseFile(filepath, { accountId: 'activo' });
  expect(result.errors).toEqual([]);
  return result.transactions as ParsedImportTransaction[];
}

async function importTransactions(
  transactions: readonly ParsedImportTransaction[],
) {
  return reconcileTransactions(
    'activo',
    transactions
      .filter(transaction => !transaction.source_skip)
      .map(transaction => {
        if (transaction.amount_minor == null) {
          throw new Error('Expected a normalized XLSX integer amount');
        }
        return {
          amount: transaction.amount_minor,
          date: transaction.date,
          imported_id: transaction.imported_id,
          imported_payee: transaction.imported_payee,
          notes: transaction.notes ?? null,
          payee_name: transaction.payee_name,
        };
      }),
    { payeeNameNormalization: 'original' },
  );
}

async function accountBalance(): Promise<number> {
  const row = await db.first<{ balance: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account = ? AND is_parent = 0`,
    ['activo'],
  );
  return row?.balance ?? 0;
}

describe('ActivoBank XLSX import', () => {
  test('recognizes the structural indicators, retains both dates, and prepares M3-compatible signed EUR rows', async () => {
    const source = createSyntheticActivoBankXlsx();
    const sourceCopy = new Uint8Array(source);
    const parsed = await parseActivoBankXlsx(source);

    expect(source).toEqual(sourceCopy);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toHaveLength(
      SYNTHETIC_ACTIVOBANK_XLSX_TRANSACTIONS.length,
    );
    expect(parsed.rows[0]).toMatchObject({
      amountMinor: -5432,
      bookingDate: '2026-10-01',
      description: 'COMPRA CARTAO CONTINENTE LISBOA SYN-001',
      statementBalanceMinor: 194568,
      valueDate: '2026-10-02',
    });

    const prepared = prepareBankImport({
      accountId: 'activo',
      createdAt: '2026-10-18T09:00:00.000Z',
      fieldMap: ACTIVOBANK_XLSX_FIELDS,
      provider: 'activobank',
      rows: toActivoBankXlsxStatementRows(parsed.rows),
      sourceFormat: 'xlsx',
    });
    expect(prepared.errors).toEqual([]);
    expect(prepared.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: -5432,
          date: '2026-10-01',
          imported_payee: 'COMPRA CARTAO CONTINENTE LISBOA SYN-001',
          payee_name: 'Continente',
          statementType: 'card-purchase',
        }),
        expect.objectContaining({ statementType: 'direct-debit' }),
        expect.objectContaining({ statementType: 'transfer' }),
        expect.objectContaining({ statementType: 'mb-way' }),
        expect.objectContaining({ statementType: 'cash-withdrawal' }),
        expect.objectContaining({ statementType: 'credit-card-payment' }),
        expect.objectContaining({ statementType: 'refund' }),
      ]),
    );

    const preview = await parseFixture(source);
    expect(preview[0]).toMatchObject({
      amount_minor: -5432,
      date: '2026-10-01',
      notes: 'Value date: 2026-10-02',
      payee_name: 'Continente',
    });
  });

  test('imports once, remains idempotent across an identical or reversed workbook, and preserves balance', async () => {
    const first = await importTransactions(
      await parseFixture(createSyntheticActivoBankXlsx()),
    );
    expect(first.added).toHaveLength(7);
    expect(await accountBalance()).toBe(-32197);

    const repeated = await importTransactions(
      await parseFixture(createSyntheticActivoBankXlsx()),
    );
    expect(repeated.added).toEqual([]);
    expect(await accountBalance()).toBe(-32197);

    const reversed = await importTransactions(
      await parseFixture(
        createSyntheticActivoBankXlsx({ reverseTransactions: true }),
      ),
    );
    expect(reversed.added).toEqual([]);
    expect(await accountBalance()).toBe(-32197);

    const overlap = await importTransactions(
      await parseFixture(
        createSyntheticActivoBankXlsx({ startTransactionAt: 3 }),
      ),
    );
    expect(overlap.added).toEqual([]);
    expect(await accountBalance()).toBe(-32197);
  });

  test('keeps same-date/same-amount movements distinct and leaves an exact duplicate visible but unchecked', async () => {
    const sameDate = await parseActivoBankXlsx(
      createSyntheticActivoBankXlsx({ sameDateSameAmount: true }),
    );
    expect(sameDate.errors).toEqual([]);
    expect(sameDate.rows).toHaveLength(2);
    expect(sameDate.rows[0].amountMinor).toBe(sameDate.rows[1].amountMinor);
    expect(sameDate.rows[0].bookingDate).toBe(sameDate.rows[1].bookingDate);
    expect(sameDate.rows[0].sourceIdentity).not.toBe(
      sameDate.rows[1].sourceIdentity,
    );
    const sameDateImported = await importTransactions(
      await parseFixture(
        createSyntheticActivoBankXlsx({ sameDateSameAmount: true }),
      ),
    );
    expect(sameDateImported.added).toHaveLength(2);
    expect(await accountBalance()).toBe(-2000);

    const duplicate = await parseFixture(
      createSyntheticActivoBankXlsx({ addExactDuplicate: true }),
    );
    expect(
      duplicate.filter(transaction => transaction.source_skip),
    ).toHaveLength(1);
  });

  test('rejects invalid layouts and values while surfacing empty and running-balance statements as warnings', async () => {
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ missingRequiredHeader: true }),
      ),
    ).resolves.toMatchObject({
      errors: [{ code: 'unrecognized-workbook' }],
      rows: [],
    });
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ nonEuroCurrency: true }),
      ),
    ).resolves.toMatchObject({ errors: [{ code: 'unsupported-currency' }] });
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ missingCurrency: true }),
      ),
    ).resolves.toMatchObject({ errors: [{ code: 'unsupported-currency' }] });
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ invalidAmountAt: 0 }),
      ),
    ).resolves.toMatchObject({ errors: [{ code: 'invalid-amount', row: 9 }] });
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ invalidBookingDateAt: 0 }),
      ),
    ).resolves.toMatchObject({
      errors: [{ code: 'invalid-booking-date', row: 9 }],
    });
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ invalidBalanceAt: 2 }),
      ),
    ).resolves.toMatchObject({
      errors: [],
      warnings: expect.arrayContaining([
        { code: 'running-balance-mismatch', row: 11 },
      ]),
    });
    await expect(
      parseActivoBankXlsx(
        createSyntheticActivoBankXlsx({ emptyStatement: true }),
      ),
    ).resolves.toMatchObject({
      errors: [],
      rows: [],
      warnings: [{ code: 'empty-statement' }],
    });
  });
});
