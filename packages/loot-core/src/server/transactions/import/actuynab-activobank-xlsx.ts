import { createHash } from 'node:crypto';

import { parseStringPromise } from 'xml2js';

import { safeUnzip } from '#server/util/zip';

import { normalizeBankPayee } from './actuynab-bank-import';

const MAX_ARCHIVE_SIZE = 20 * 1024 * 1024;
const MAX_ENTRY_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_SIZE = 30 * 1024 * 1024;

const REQUIRED_HEADERS = {
  amount: 'valor',
  balance: 'saldo',
  bookingDate: 'data lanc',
  description: 'descricao',
  valueDate: 'data valor',
} as const;

type RequiredHeader = keyof typeof REQUIRED_HEADERS;

type XmlRecord = Record<string, unknown>;

type SpreadsheetCell = {
  column: string;
  value: string | null;
};

type SpreadsheetRow = {
  cells: SpreadsheetCell[];
  rowNumber: number;
};

export type ActivoBankXlsxIssueCode =
  | 'empty-statement'
  | 'invalid-amount'
  | 'invalid-balance'
  | 'invalid-booking-date'
  | 'invalid-value-date'
  | 'malformed-row'
  | 'running-balance-mismatch'
  | 'source-duplicate'
  | 'unsupported-currency'
  | 'unrecognized-workbook'
  | 'unsafe-workbook';

export type ActivoBankXlsxIssue = {
  code: ActivoBankXlsxIssueCode;
  row?: number;
};

export type ActivoBankXlsxRow = {
  amountMinor: number;
  bookingDate: string;
  description: string;
  excelRow: number;
  sourceIdentity: string;
  statementBalanceMinor: number;
  valueDate: string;
};

export type ParsedActivoBankXlsx = {
  errors: ActivoBankXlsxIssue[];
  rows: ActivoBankXlsxRow[];
  warnings: ActivoBankXlsxIssue[];
};

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function asRecord(value: unknown): XmlRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlRecord)
    : null;
}

function localName(name: string): string {
  return name.split(':').at(-1) ?? name;
}

function children(record: XmlRecord | null, name: string): unknown[] {
  if (!record) {
    return [];
  }
  return Object.entries(record).flatMap(([key, value]) =>
    localName(key) === name ? asArray(value) : [],
  );
}

function attribute(node: unknown, name: string): string | null {
  const attributes = asRecord(asRecord(node)?.$);
  const value = attributes?.[name];
  return typeof value === 'string' ? value : null;
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textContent).join('');
  }
  const record = asRecord(node);
  if (!record) {
    return '';
  }
  return Object.entries(record)
    .filter(([key]) => key !== '$')
    .map(([, value]) => textContent(value))
    .join('');
}

async function parseXml(bytes: Uint8Array): Promise<XmlRecord | null> {
  const value = await parseStringPromise(
    new TextDecoder('utf-8').decode(bytes),
    {
      explicitArray: false,
    },
  );
  return asRecord(value);
}

function canonicalHeader(value: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function columnFromReference(reference: string | null): string | null {
  const match = reference?.match(/^([A-Z]+)[0-9]+$/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function isValidDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function formatExcelDate(value: number): string | null {
  if (!Number.isFinite(value) || value < 61 || value > 2_958_465) {
    return null;
  }
  const date = new Date(
    Date.UTC(1899, 11, 30) + Math.floor(value) * 24 * 60 * 60 * 1000,
  );
  const iso = date.toISOString().slice(0, 10);
  return isValidDate(iso) ? iso : null;
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return formatExcelDate(Number(trimmed));
  }

  const portuguese = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (portuguese) {
    const [, day, month, year] = portuguese;
    const iso = `${year}-${month}-${day}`;
    return isValidDate(iso) ? iso : null;
  }

  const iso = trimmed.slice(0, 10);
  return isValidDate(iso) ? iso : null;
}

function parseMinorUnits(value: string | null): number | null {
  if (!value) {
    return null;
  }
  let normalized = value.trim().replace(/[\s\u00a0\u20ac]/g, '');
  const parenthesized = /^\(.*\)$/.test(normalized);
  if (parenthesized) {
    normalized = normalized.slice(1, -1);
  }
  if (!/^[+-]?[0-9.,]+$/.test(normalized)) {
    return null;
  }

  const sign = normalized.startsWith('-') || parenthesized ? -1 : 1;
  normalized = normalized.replace(/^[+-]/, '');
  const lastComma = normalized.lastIndexOf(',');
  const lastPeriod = normalized.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastPeriod);
  const decimalLength =
    decimalIndex === -1 ? 0 : normalized.length - decimalIndex - 1;
  const hasDecimal = decimalLength > 0 && decimalLength <= 2;
  const whole = normalized
    .slice(0, hasDecimal ? decimalIndex : normalized.length)
    .replace(/[.,]/g, '');
  const fraction = hasDecimal
    ? normalized.slice(decimalIndex + 1).padEnd(2, '0')
    : '00';
  if (!/^\d+$/.test(whole) || !/^\d{2}$/.test(fraction)) {
    return null;
  }

  const minor = Number(whole) * 100 + Number(fraction);
  return Number.isSafeInteger(minor) ? sign * minor : null;
}

function formatMinorUnits(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseSharedStrings(document: XmlRecord | null): string[] {
  const root = children(document, 'sst')[0];
  return children(asRecord(root), 'si').map(value => textContent(value));
}

function parseCell(
  cell: unknown,
  sharedStrings: readonly string[],
): SpreadsheetCell | null {
  const column = columnFromReference(attribute(cell, 'r'));
  if (!column) {
    return null;
  }
  const record = asRecord(cell);
  const type = attribute(cell, 't');
  if (type === 'inlineStr') {
    return { column, value: textContent(children(record, 'is')[0]) || null };
  }

  const rawValue = textContent(children(record, 'v')[0]) || null;
  if (type === 's') {
    const index = rawValue == null ? Number.NaN : Number(rawValue);
    return {
      column,
      value:
        Number.isInteger(index) && index >= 0
          ? (sharedStrings[index] ?? null)
          : null,
    };
  }
  return { column, value: rawValue };
}

function parseWorksheetRows(
  document: XmlRecord | null,
  sharedStrings: readonly string[],
): SpreadsheetRow[] | null {
  const worksheet = asRecord(children(document, 'worksheet')[0]);
  const sheetData = asRecord(children(worksheet, 'sheetData')[0]);
  if (!worksheet || !sheetData) {
    return null;
  }

  const rows: SpreadsheetRow[] = [];
  for (const rawRow of children(sheetData, 'row')) {
    const rowNumber = Number(attribute(rawRow, 'r'));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) {
      return null;
    }
    const cells = children(asRecord(rawRow), 'c')
      .map(cell => parseCell(cell, sharedStrings))
      .filter((cell): cell is SpreadsheetCell => cell != null);
    rows.push({ cells, rowNumber });
  }
  return rows;
}

function cellValue(row: SpreadsheetRow, column: string): string | null {
  return row.cells.find(cell => cell.column === column)?.value ?? null;
}

function findHeaderRow(rows: readonly SpreadsheetRow[]): {
  columns: Record<RequiredHeader, string>;
  rowIndex: number;
} | null {
  const expected = new Map<string, RequiredHeader>(
    (Object.entries(REQUIRED_HEADERS) as Array<[RequiredHeader, string]>).map(
      ([key, value]) => [value, key],
    ),
  );
  for (const [rowIndex, row] of rows.entries()) {
    const columns = {} as Record<RequiredHeader, string>;
    for (const cell of row.cells) {
      const key = expected.get(canonicalHeader(cell.value));
      if (key) {
        columns[key] = cell.column;
      }
    }
    if (Object.keys(columns).length === Object.keys(REQUIRED_HEADERS).length) {
      return { columns, rowIndex };
    }
  }
  return null;
}

function statementCurrency(rows: readonly SpreadsheetRow[]): string | null {
  const text = rows
    .flatMap(row => row.cells)
    .map(cell => cell.value)
    .filter((value): value is string => value != null)
    .join(' ')
    .toUpperCase();
  if (text.includes('EUR')) {
    return 'EUR';
  }
  return /\b(?:USD|GBP|CHF|BRL)\b/.test(text) ? 'other' : null;
}

function validateRunningBalances(rows: readonly ActivoBankXlsxRow[]) {
  const warnings: ActivoBankXlsxIssue[] = [];
  let ascendingMatches = 0;
  let descendingMatches = 0;

  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (
      current.statementBalanceMinor - previous.statementBalanceMinor ===
      current.amountMinor
    ) {
      ascendingMatches++;
    }
    if (
      previous.statementBalanceMinor - current.statementBalanceMinor ===
      previous.amountMinor
    ) {
      descendingMatches++;
    }
  }

  const direction =
    ascendingMatches > descendingMatches
      ? 'ascending'
      : descendingMatches > ascendingMatches
        ? 'descending'
        : null;

  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    const isAscending =
      current.statementBalanceMinor - previous.statementBalanceMinor ===
      current.amountMinor;
    const isDescending =
      previous.statementBalanceMinor - current.statementBalanceMinor ===
      previous.amountMinor;
    if (
      (direction === 'ascending' && !isAscending) ||
      (direction === 'descending' && !isDescending) ||
      (direction == null && !isAscending && !isDescending)
    ) {
      warnings.push({
        code: 'running-balance-mismatch',
        row: current.excelRow,
      });
    }
  }
  return warnings;
}

export function formatActivoBankXlsxIssue(issue: ActivoBankXlsxIssue): string {
  const row = issue.row == null ? '' : ` on row ${issue.row}`;
  switch (issue.code) {
    case 'empty-statement':
      return 'The ActivoBank XLSX statement contains no transaction rows.';
    case 'invalid-amount':
      return `The ActivoBank XLSX statement has an invalid signed amount${row}.`;
    case 'invalid-balance':
      return `The ActivoBank XLSX statement has an invalid running balance${row}.`;
    case 'invalid-booking-date':
      return `The ActivoBank XLSX statement has an invalid booking date${row}.`;
    case 'invalid-value-date':
      return `The ActivoBank XLSX statement has an invalid value date${row}.`;
    case 'malformed-row':
      return `The ActivoBank XLSX statement has a malformed transaction row${row}.`;
    case 'running-balance-mismatch':
      return `The ActivoBank XLSX running balance does not reconcile${row}.`;
    case 'source-duplicate':
      return `The ActivoBank XLSX statement contains an exact duplicate movement${row}.`;
    case 'unsupported-currency':
      return 'The ActivoBank XLSX statement does not identify EUR as its currency.';
    case 'unsafe-workbook':
      return 'The XLSX workbook could not be read safely.';
    case 'unrecognized-workbook':
      return 'This workbook does not match the supported ActivoBank XLSX statement structure.';
    default:
      return 'The ActivoBank XLSX statement could not be processed safely.';
  }
}

/**
 * Parse the verified ActivoBank Portugal workbook shape without mutating the
 * source bytes. A recognised statement has one worksheet and a row containing
 * all five expected Portuguese transaction headers; the row number itself is
 * intentionally not used as its sole identifier.
 */
export async function parseActivoBankXlsx(
  contents: Uint8Array,
): Promise<ParsedActivoBankXlsx> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = safeUnzip(contents, {
      maxArchiveSize: MAX_ARCHIVE_SIZE,
      maxEntrySize: MAX_ENTRY_SIZE,
      maxTotalUncompressedSize: MAX_TOTAL_UNCOMPRESSED_SIZE,
    });
  } catch {
    return {
      errors: [{ code: 'unsafe-workbook' }],
      rows: [],
      warnings: [],
    };
  }

  const worksheetNames = Object.keys(entries).filter(name =>
    /^xl\/worksheets\/[^/]+\.xml$/i.test(name),
  );
  if (
    !entries['[Content_Types].xml'] ||
    !entries['xl/workbook.xml'] ||
    worksheetNames.length !== 1
  ) {
    return {
      errors: [{ code: 'unrecognized-workbook' }],
      rows: [],
      warnings: [],
    };
  }

  let worksheet: XmlRecord | null;
  let sharedStrings: string[] = [];
  try {
    worksheet = await parseXml(entries[worksheetNames[0]]);
    if (entries['xl/sharedStrings.xml']) {
      sharedStrings = parseSharedStrings(
        await parseXml(entries['xl/sharedStrings.xml']),
      );
    }
  } catch {
    return {
      errors: [{ code: 'unrecognized-workbook' }],
      rows: [],
      warnings: [],
    };
  }

  const spreadsheetRows = parseWorksheetRows(worksheet, sharedStrings);
  const header = spreadsheetRows && findHeaderRow(spreadsheetRows);
  if (!spreadsheetRows || !header) {
    return {
      errors: [{ code: 'unrecognized-workbook' }],
      rows: [],
      warnings: [],
    };
  }

  if (statementCurrency(spreadsheetRows.slice(0, header.rowIndex)) !== 'EUR') {
    return {
      errors: [{ code: 'unsupported-currency' }],
      rows: [],
      warnings: [],
    };
  }

  const errors: ActivoBankXlsxIssue[] = [];
  const rows: ActivoBankXlsxRow[] = [];
  const duplicateRows = new Set<string>();
  const identities = new Set<string>();
  for (const row of spreadsheetRows.slice(header.rowIndex + 1)) {
    if (row.cells.length === 0) {
      continue;
    }
    const bookingDate = parseDate(cellValue(row, header.columns.bookingDate));
    const valueDate = parseDate(cellValue(row, header.columns.valueDate));
    const description = cellValue(row, header.columns.description)?.trim();
    const amountMinor = parseMinorUnits(cellValue(row, header.columns.amount));
    const statementBalanceMinor = parseMinorUnits(
      cellValue(row, header.columns.balance),
    );

    if (!bookingDate) {
      errors.push({ code: 'invalid-booking-date', row: row.rowNumber });
    }
    if (!valueDate) {
      errors.push({ code: 'invalid-value-date', row: row.rowNumber });
    }
    if (!description) {
      errors.push({ code: 'malformed-row', row: row.rowNumber });
    }
    if (amountMinor == null) {
      errors.push({ code: 'invalid-amount', row: row.rowNumber });
    }
    if (statementBalanceMinor == null) {
      errors.push({ code: 'invalid-balance', row: row.rowNumber });
    }
    if (
      !bookingDate ||
      !valueDate ||
      !description ||
      amountMinor == null ||
      statementBalanceMinor == null
    ) {
      continue;
    }

    const sourceIdentity = hash({
      amountMinor,
      bookingDate,
      description,
      statementBalanceMinor,
      valueDate,
    });
    if (identities.has(sourceIdentity)) {
      duplicateRows.add(sourceIdentity);
    }
    identities.add(sourceIdentity);
    rows.push({
      amountMinor,
      bookingDate,
      description,
      excelRow: row.rowNumber,
      sourceIdentity,
      statementBalanceMinor,
      valueDate,
    });
  }

  if (errors.length > 0) {
    return { errors, rows: [], warnings: [] };
  }

  const warnings = validateRunningBalances(rows);
  for (const row of rows) {
    if (duplicateRows.has(row.sourceIdentity)) {
      warnings.push({ code: 'source-duplicate', row: row.excelRow });
    }
  }
  if (rows.length === 0) {
    warnings.push({ code: 'empty-statement' });
  }
  return { errors, rows, warnings };
}

export function toActivoBankXlsxStatementRows(
  rows: readonly ActivoBankXlsxRow[],
) {
  return rows.map(row => ({
    amount: formatMinorUnits(row.amountMinor),
    bookingDate: row.bookingDate,
    description: row.description,
    sourceIdentity: row.sourceIdentity,
    valueDate: row.valueDate,
  }));
}

export function toActivoBankXlsxImportTransactions(
  rows: readonly ActivoBankXlsxRow[],
  prepared: ReadonlyArray<{
    amount?: number;
    imported_id?: string | null;
    imported_payee?: string | null;
    payee_name?: string | null;
    skipTransaction?: boolean;
    sourceRow: number;
  }>,
) {
  return prepared.flatMap(transaction => {
    const row = rows[transaction.sourceRow - 1];
    if (!row || transaction.amount == null) {
      return [];
    }
    return [
      {
        amount: transaction.amount / 100,
        amount_minor: transaction.amount,
        date: row.bookingDate,
        imported_id: transaction.imported_id ?? undefined,
        imported_payee: transaction.imported_payee ?? row.description,
        notes:
          row.bookingDate === row.valueDate
            ? null
            : `Value date: ${row.valueDate}`,
        payee_name:
          transaction.payee_name ?? normalizeBankPayee(row.description),
        source_skip: Boolean(transaction.skipTransaction),
        statement_balance_minor: row.statementBalanceMinor,
        value_date: row.valueDate,
      },
    ];
  });
}
