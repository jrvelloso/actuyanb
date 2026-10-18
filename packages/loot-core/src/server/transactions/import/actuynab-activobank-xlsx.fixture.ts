import { strToU8, zipSync } from 'fflate';

type SyntheticTransaction = {
  amountMinor: number;
  balanceMinor: number;
  bookingDate: string;
  description: string;
  valueDate: string;
};

export type SyntheticActivoBankXlsxOptions = {
  addExactDuplicate?: boolean;
  emptyStatement?: boolean;
  invalidAmountAt?: number;
  invalidBalanceAt?: number;
  invalidBookingDateAt?: number;
  missingCurrency?: boolean;
  missingRequiredHeader?: boolean;
  nonEuroCurrency?: boolean;
  reverseTransactions?: boolean;
  sameDateSameAmount?: boolean;
  startTransactionAt?: number;
};

export const SYNTHETIC_ACTIVOBANK_XLSX_TRANSACTIONS: readonly SyntheticTransaction[] =
  [
    {
      amountMinor: -5432,
      balanceMinor: 194568,
      bookingDate: '2026-10-01',
      description: 'COMPRA CARTAO CONTINENTE LISBOA SYN-001',
      valueDate: '2026-10-02',
    },
    {
      amountMinor: -8765,
      balanceMinor: 185803,
      bookingDate: '2026-10-02',
      description: 'DEBITO DIRECTO UTILIDADES SINTETICAS',
      valueDate: '2026-10-02',
    },
    {
      amountMinor: -20000,
      balanceMinor: 165803,
      bookingDate: '2026-10-03',
      description: 'TRANSFERENCIA PARA MILLENIUM SYN-TRF-001',
      valueDate: '2026-10-03',
    },
    {
      amountMinor: 12000,
      balanceMinor: 177803,
      bookingDate: '2026-10-04',
      description: 'MB WAY RECEBIDO CONTRIBUTOR SINTETICO',
      valueDate: '2026-10-04',
    },
    {
      amountMinor: -4000,
      balanceMinor: 173803,
      bookingDate: '2026-10-05',
      description: 'LEVANTAMENTO ATM SINTETICO',
      valueDate: '2026-10-05',
    },
    {
      amountMinor: -7000,
      balanceMinor: 166803,
      bookingDate: '2026-10-06',
      description: 'PAGAMENTO CC ACTIVO CLASSIC SYN-002',
      valueDate: '2026-10-06',
    },
    {
      amountMinor: 1000,
      balanceMinor: 167803,
      bookingDate: '2026-10-07',
      description: 'REEMBOLSO CONTINENTE SYN-003',
      valueDate: '2026-10-08',
    },
  ];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function excelSerial(date: string): number {
  const milliseconds = new Date(`${date}T00:00:00.000Z`).getTime();
  return Math.round(
    (milliseconds - Date.UTC(1899, 11, 30)) / (24 * 60 * 60 * 1000),
  );
}

function formatMinorUnits(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function textCell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function numberCell(
  reference: string,
  value: number | string,
  style?: number,
): string {
  const styleAttribute = style == null ? '' : ` s="${style}"`;
  return `<c r="${reference}"${styleAttribute}><v>${value}</v></c>`;
}

function worksheetXml(options: SyntheticActivoBankXlsxOptions): string {
  const headers = [
    'Data Lanc.',
    'Data Valor',
    options.missingRequiredHeader ? 'Descrição ausente' : 'Descrição',
    'Valor',
    'Saldo',
  ];
  let transactions = [...SYNTHETIC_ACTIVOBANK_XLSX_TRANSACTIONS];
  if (options.sameDateSameAmount) {
    transactions = [
      {
        amountMinor: -1000,
        balanceMinor: 99000,
        bookingDate: '2026-10-01',
        description: 'COMPRA SINTETICA PRIMEIRA',
        valueDate: '2026-10-01',
      },
      {
        amountMinor: -1000,
        balanceMinor: 98000,
        bookingDate: '2026-10-01',
        description: 'COMPRA SINTETICA SEGUNDA',
        valueDate: '2026-10-01',
      },
    ];
  }
  if (options.reverseTransactions) {
    transactions = transactions.reverse();
  }
  if (options.addExactDuplicate) {
    transactions.push({ ...transactions[0] });
  }
  if (options.startTransactionAt != null) {
    transactions = transactions.slice(options.startTransactionAt);
  }
  if (options.emptyStatement) {
    transactions = [];
  }

  const metadata = [
    `<row r="1">${textCell('A1', 'Extrato de conta sintético')}</row>`,
    `<row r="2">${textCell('A2', 'Conta conjunta de validação')}</row>`,
    `<row r="3">${textCell(
      'A3',
      options.missingCurrency
        ? 'Moeda nao identificada'
        : options.nonEuroCurrency
          ? 'Moeda: USD'
          : 'Moeda: EUR',
    )}</row>`,
    `<row r="8">${headers
      .map((header, index) =>
        textCell(`${String.fromCharCode(65 + index)}8`, header),
      )
      .join('')}</row>`,
  ];
  const transactionRows = transactions.map((transaction, index) => {
    const rowNumber = index + 9;
    const balance =
      options.invalidBalanceAt === index
        ? transaction.balanceMinor + 1
        : transaction.balanceMinor;
    const bookingDate =
      options.invalidBookingDateAt === index
        ? textCell(`A${rowNumber}`, 'not-a-date')
        : numberCell(`A${rowNumber}`, excelSerial(transaction.bookingDate), 1);
    const amount =
      options.invalidAmountAt === index
        ? textCell(`D${rowNumber}`, 'not-an-amount')
        : numberCell(
            `D${rowNumber}`,
            formatMinorUnits(transaction.amountMinor),
          );
    return `<row r="${rowNumber}">${bookingDate}${numberCell(`B${rowNumber}`, excelSerial(transaction.valueDate), 1)}${textCell(`C${rowNumber}`, transaction.description)}${amount}${numberCell(`E${rowNumber}`, formatMinorUnits(balance))}</row>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${[...metadata, ...transactionRows].join('')}</sheetData></worksheet>`;
}

export function createSyntheticActivoBankXlsx(
  options: SyntheticActivoBankXlsxOptions = {},
): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      'xl/_rels/workbook.xml.rels':
        strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
      'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`),
      'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Extrato" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      'xl/worksheets/sheet1.xml': strToU8(worksheetXml(options)),
    },
    { mtime: new Date('2026-10-18T00:00:00.000Z') },
  );
}
