import { addTransactions } from '#server/accounts/sync';
import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import * as prefs from '#server/prefs';
import { loadRules } from '#server/transactions/transaction-rules';

import {
  ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
  commitBankImport,
  formatBankImportAuditJson,
  formatBankImportAuditMarkdown,
  prepareBankImport,
  requireReviewForAmbiguousMatches,
  REVOLUT_SYNTHETIC_CSV_FIELDS,
  suggestHouseholdTransferPairs,
  suggestTransferPairs,
} from './actuynab-bank-import';
import type { StatementRow } from './actuynab-bank-import';
import { parseFile } from './parse-file';

const fixtures = __dirname + '/../../../mocks/files/';
const createdAt = '2026-10-17T09:00:00.000Z';

beforeEach(async () => {
  await global.emptyDatabase()();
  await loadMappings();
  await loadRules();
  await prefs.loadPrefs();
});

async function readCsvFixture(filename: string, delimiter = ',') {
  const result = await parseFile(fixtures + filename, {
    delimiter,
    hasHeaderRow: true,
  });
  expect(result.errors).toEqual([]);
  return result.transactions as StatementRow[];
}

async function accountBalance(account: string) {
  const row = await db.first<{ balance: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS balance
     FROM v_transactions
     WHERE account = ? AND is_parent = 0`,
    [account],
  );
  return row?.balance ?? 0;
}

async function createAccounts(...ids: string[]) {
  await Promise.all(ids.map(id => db.insertAccount({ id, name: `M3 ${id}` })));
}

async function prepareActivo(accountId = 'm3-activobank') {
  return prepareBankImport({
    accountId,
    createdAt,
    fieldMap: ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
    provider: 'activobank',
    rows: await readCsvFixture('actuynab-m3-activobank-synthetic.csv', ';'),
    sourceFormat: 'csv',
  });
}

async function prepareRevolut(accountId = 'm3-revolut') {
  return prepareBankImport({
    accountCurrency: 'EUR',
    accountId,
    createdAt,
    fieldMap: REVOLUT_SYNTHETIC_CSV_FIELDS,
    provider: 'revolut',
    rows: await readCsvFixture('actuynab-m3-revolut-synthetic.csv'),
    sourceFormat: 'csv',
  });
}

describe('ActuYNAB Milestone 3 bank import automation', () => {
  test('normalizes explicitly synthetic ActivoBank and Revolut statements without storing raw input in the audit record', async () => {
    const activoRows = await readCsvFixture(
      'actuynab-m3-activobank-synthetic.csv',
      ';',
    );
    const originalActivoRows = JSON.stringify(activoRows);
    const activo = prepareBankImport({
      accountId: 'm3-activobank',
      createdAt,
      fieldMap: ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
      provider: 'activobank',
      rows: activoRows,
      sourceFormat: 'csv',
    });
    const revolut = await prepareRevolut();

    expect(JSON.stringify(activoRows)).toBe(originalActivoRows);
    expect(activo.audit).toMatchObject({
      parsed: 4,
      provider: 'activobank',
      totalAmount: -10984,
    });
    expect(activo.transactions[0]).toMatchObject({
      amount: -1234,
      date: '2024-03-02',
      imported_payee: 'COMPRA CARTAO CONTINENTE MONTIJO 123456',
      payee_name: 'Continente',
      statementType: 'card-purchase',
    });
    expect(revolut.audit).toMatchObject({
      parsed: 5,
      provider: 'revolut',
      totalAmount: 7496,
      warnings: 1,
    });
    expect(revolut.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: -2294,
          imported_payee: 'USD purchase',
          statementType: 'card-purchase',
        }),
        expect.objectContaining({
          amount: -30,
          imported_payee: 'USD purchase fee',
          statementType: 'fee',
        }),
        expect.objectContaining({
          cleared: false,
          imported_payee: 'Pending metro',
        }),
      ]),
    );

    const unsupportedCurrency = prepareBankImport({
      accountCurrency: 'EUR',
      accountId: 'm3-revolut',
      createdAt,
      fieldMap: REVOLUT_SYNTHETIC_CSV_FIELDS,
      provider: 'revolut',
      rows: [
        {
          Amount: '-5.00',
          'Completed Date': '2024-03-08',
          Currency: 'USD',
          Description: 'Unsettled foreign purchase',
          ID: 'REV-unsupported-currency',
          State: 'COMPLETED',
          Type: 'card_payment',
        },
      ],
      sourceFormat: 'csv',
    });
    expect(unsupportedCurrency.errors).toEqual([
      { code: 'currency-not-imported', row: 1 },
    ]);

    const exchange = prepareBankImport({
      accountCurrency: 'EUR',
      accountId: 'm3-revolut',
      createdAt,
      fieldMap: REVOLUT_SYNTHETIC_CSV_FIELDS,
      provider: 'revolut',
      rows: [
        {
          Amount: '-10.00',
          'Completed Date': '2024-03-08',
          Currency: 'EUR',
          Description: 'Currency exchange',
          ID: 'REV-exchange',
          State: 'COMPLETED',
          Type: 'exchange',
        },
      ],
      sourceFormat: 'csv',
    });
    expect(exchange.transactions[0].statementType).toBe('exchange');

    const json = formatBankImportAuditJson(revolut.audit);
    expect(JSON.parse(json)).toEqual(revolut.audit);
    expect(json).not.toContain('Coffee Shop');
    expect(formatBankImportAuditMarkdown(revolut.audit)).toContain(
      '| 5 | 0 | 0 | 0 | 0 | 0 | 1 | 7496 |',
    );
    expect(await db.all('SELECT * FROM transactions')).toEqual([]);
  });

  test('is financially idempotent for repeated and overlapping imports while preserving an existing payee', async () => {
    await createAccounts('m3-activobank');
    const firstPrepared = await requireReviewForAmbiguousMatches(
      await prepareActivo(),
    );
    const first = await commitBankImport(firstPrepared);

    expect(first.audit).toMatchObject({
      duplicate: 0,
      imported: 4,
      skipped: 0,
      updated: 0,
    });
    expect(await accountBalance('m3-activobank')).toBe(-10984);

    const repeated = await commitBankImport(
      await requireReviewForAmbiguousMatches(await prepareActivo()),
    );
    expect(repeated.audit).toMatchObject({
      duplicate: 4,
      imported: 0,
      updated: 0,
    });
    expect(await accountBalance('m3-activobank')).toBe(-10984);

    const withoutStableId = await readCsvFixture(
      'actuynab-m3-activobank-synthetic.csv',
      ';',
    );
    delete withoutStableId[0]['Referência'];
    const overlap = await commitBankImport(
      await requireReviewForAmbiguousMatches(
        prepareBankImport({
          accountId: 'm3-activobank',
          createdAt,
          fieldMap: ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
          provider: 'activobank',
          rows: [withoutStableId[0]],
          sourceFormat: 'csv',
        }),
      ),
    );
    expect(overlap.audit).toMatchObject({ imported: 0, updated: 1 });
    expect(await accountBalance('m3-activobank')).toBe(-10984);

    const confirmedPayee = await db.insertPayee({
      id: 'm3-confirmed-payee',
      name: 'My confirmed Continente',
    });
    await addTransactions(
      'm3-activobank',
      [
        {
          amount: -777,
          date: '2024-03-10',
          payee: confirmedPayee,
        },
      ],
      { runTransfers: false },
    );
    const confirmed = await commitBankImport(
      await requireReviewForAmbiguousMatches(
        prepareBankImport({
          accountId: 'm3-activobank',
          createdAt,
          fieldMap: ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
          provider: 'activobank',
          rows: [
            {
              'Data movimento': '10/03/2024',
              Descrição: 'COMPRA CARTAO CONTINENTE LISBOA 9999',
              Débito: '7,77',
            },
          ],
          sourceFormat: 'csv',
        }),
      ),
    );
    expect(confirmed.audit).toMatchObject({ imported: 0, updated: 1 });
    expect(
      await db.first<{ payee: string }>(
        `SELECT payee FROM v_transactions
         WHERE account = ? AND amount = ? AND date = ?`,
        ['m3-activobank', -777, 20240310],
      ),
    ).toEqual({ payee: 'm3-confirmed-payee' });
  });

  test('flags an ambiguous fallback match for review and remains recoverable after an interrupted run', async () => {
    await createAccounts('m3-ambiguous', 'm3-recovery');
    await addTransactions(
      'm3-ambiguous',
      [
        { amount: -1234, date: '2024-03-02', payee_name: 'First candidate' },
        { amount: -1234, date: '2024-03-02', payee_name: 'Second candidate' },
      ],
      { runTransfers: false },
    );

    const ambiguous = await requireReviewForAmbiguousMatches(
      prepareBankImport({
        accountId: 'm3-ambiguous',
        createdAt,
        fieldMap: ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
        provider: 'activobank',
        rows: [
          {
            'Data movimento': '02/03/2024',
            Descrição: 'COMPRA CARTAO CONTINENTE PORTO 42',
            Débito: '12,34',
          },
        ],
        sourceFormat: 'csv',
      }),
    );
    expect(ambiguous.warnings).toContainEqual({
      code: 'ambiguous-match',
      row: 1,
    });
    const notApproved = await commitBankImport(ambiguous);
    expect(notApproved.audit).toMatchObject({ imported: 0, skipped: 1 });
    expect(await accountBalance('m3-ambiguous')).toBe(-2468);

    // Simulate recovering after the first commit completed but before a caller
    // stored or displayed its audit report. Rerunning the untouched source is
    // ID-first and produces no new financial transaction.
    const recoveryPrepared = await requireReviewForAmbiguousMatches(
      await prepareActivo('m3-recovery'),
    );
    const interruptedAttempt = await commitBankImport(recoveryPrepared);
    expect(interruptedAttempt.audit.imported).toBe(4);
    const recovered = await commitBankImport(
      await requireReviewForAmbiguousMatches(
        await prepareActivo('m3-recovery'),
      ),
    );
    expect(recovered.audit).toMatchObject({ duplicate: 4, imported: 0 });
    expect(await accountBalance('m3-recovery')).toBe(-10984);
  });

  test('suggests an unambiguous cross-account transfer without creating one automatically', async () => {
    await createAccounts('m3-activobank', 'm3-revolut');
    const activoRows = await readCsvFixture(
      'actuynab-m3-activobank-synthetic.csv',
      ';',
    );
    const revolutRows = await readCsvFixture(
      'actuynab-m3-revolut-synthetic.csv',
    );
    const activo = await requireReviewForAmbiguousMatches(
      prepareBankImport({
        accountId: 'm3-activobank',
        createdAt,
        fieldMap: ACTIVOBANK_SYNTHETIC_CSV_FIELDS,
        provider: 'activobank',
        rows: [activoRows[1]],
        sourceFormat: 'csv',
      }),
    );
    const revolut = await requireReviewForAmbiguousMatches(
      prepareBankImport({
        accountCurrency: 'EUR',
        accountId: 'm3-revolut',
        createdAt,
        fieldMap: REVOLUT_SYNTHETIC_CSV_FIELDS,
        provider: 'revolut',
        rows: [revolutRows[0]],
        sourceFormat: 'csv',
      }),
    );

    expect(suggestTransferPairs(activo, revolut)).toEqual([
      {
        destinationAccountId: 'm3-revolut',
        sourceAccountId: 'm3-activobank',
        sourceRows: [1, 1],
        transferReference: 'TRF-20240303',
      },
    ]);
    await commitBankImport(activo);
    await commitBankImport(revolut);
    expect(await accountBalance('m3-activobank')).toBe(-10000);
    expect(await accountBalance('m3-revolut')).toBe(10000);
    expect(
      (await accountBalance('m3-activobank')) +
        (await accountBalance('m3-revolut')),
    ).toBe(0);
  });

  test('suggests a configured Activo-to-Millenium transfer only when the counterpart is unique', () => {
    const fieldMap = {
      amount: 'Amount',
      bookingDate: 'Booking date',
      description: 'Description',
    };
    const source = prepareBankImport({
      accountId: 'm9-activo',
      createdAt,
      fieldMap,
      provider: 'activobank',
      rows: [
        {
          Amount: '-250.00',
          'Booking date': '10/04/2026',
          Description: 'TRANSFERÊNCIA PARA MILLENIUM',
        },
      ],
      sourceFormat: 'csv',
    });
    const destination = prepareBankImport({
      accountId: 'm9-millenium',
      createdAt,
      fieldMap,
      provider: 'activobank',
      rows: [
        {
          Amount: '250.00',
          'Booking date': '10/04/2026',
          Description: 'TRANSFERÊNCIA RECEBIDA',
        },
      ],
      sourceFormat: 'csv',
    });
    const accounts = [
      {
        id: 'm9-activo',
        role: 'joint-checking',
        transferDescriptionTokens: ['TRANSFERENCIA PARA ACTIVO'],
      },
      {
        id: 'm9-millenium',
        role: 'joint-checking',
        transferDescriptionTokens: ['TRANSFERENCIA PARA MILLENIUM'],
      },
    ];

    expect(
      suggestHouseholdTransferPairs(source, destination, accounts),
    ).toEqual([
      {
        destinationAccountId: 'm9-millenium',
        reason: 'configured-household-token',
        requiresManualReview: true,
        sourceAccountId: 'm9-activo',
        sourceRows: [1, 1],
      },
    ]);

    const ambiguousSource = prepareBankImport({
      accountId: 'm9-activo',
      createdAt,
      fieldMap,
      provider: 'activobank',
      rows: [
        {
          Amount: '-250.00',
          'Booking date': '10/04/2026',
          Description: 'TRANSFERÊNCIA PARA MILLENIUM REFERÊNCIA A',
        },
        {
          Amount: '-250.00',
          'Booking date': '10/04/2026',
          Description: 'TRANSFERÊNCIA PARA MILLENIUM REFERÊNCIA B',
        },
      ],
      sourceFormat: 'csv',
    });
    expect(
      suggestHouseholdTransferPairs(ambiguousSource, destination, accounts),
    ).toEqual([]);
  });
});
