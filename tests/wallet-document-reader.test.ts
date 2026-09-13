import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { parseDelimited, readExpenseDocument, groupTextLines, extractPositionedStatementTables, type PositionedDocumentText } from "../src/lib/documentReader";
import { previewExpenseDocument } from "../src/lib/statementImport";

test("CSV handles quoted separators, escaped quotes and multiline descriptions", () => {
  assert.deepEqual(parseDelimited('Date;Description;Amount\r\n2026-09-01;"Cafe; ""Paris""\nLunch";"-12,34"'), [["Date", "Description", "Amount"], ["2026-09-01", 'Cafe; "Paris"\nLunch', "-12,34"]]);
  assert.throws(() => parseDelimited('a,b\n"unfinished'), /invalid-delimited/);
  assert.throws(() => parseDelimited("a\n".repeat(20_000) + "last"), /limit/, "last unterminated row is included in the limit");
});
test("TSV, OFX, QIF and generic JSON statements are read without filename reliance", async () => {
  const tsv = await readExpenseDocument(new File(['Date\tDescription\tAmount\n2026-09-01\tCafe\t-12.34'], "data.bin"));
  assert.equal(tsv.tables[0].rows[1][2], "-12.34");
  const ofx = await readExpenseDocument(new File(['OFXHEADER:100\n<OFX><CURDEF>EUR\n<STMTTRN><DTPOSTED>20260901123000[+2:CET]\n<NAME>Cafe\n<TRNAMT>-12.34\n<TRNTYPE>DEBIT\n<FITID>x1\n</STMTTRN></OFX>'], "download"));
  assert.deepEqual(ofx.tables[0].rows[1], ["2026-09-01", "Cafe", "-12.34", "EUR", "DEBIT", "x1"]);
  const qif = await readExpenseDocument(new File(['!Type:Bank\nD01/09/2026\nPCafe\nT-12.34\n^'], "download"));
  assert.deepEqual(qif.tables[0].rows[1], ["01/09/2026", "Cafe", "-12.34", ""]);
  const json = await readExpenseDocument(new File([JSON.stringify({ transactions: [{ date: "2026-09-01", merchant: "Cafe", amount: -12.34 }] })], "download.bin"));
  assert.deepEqual(json.tables[0].rows[1], ["2026-09-01", "Cafe", "-12.34"]);
});
test("XLSX local calendar dates never shift a day in Paris or Seoul", async () => {
  const prior = process.env.TZ;
  try {
    const workbook = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([["Date", "Merchant", "Amount"], [46266, "Cafe", -12.34]]);
    sheet.A2.z = "yyyy-mm-dd"; XLSX.utils.book_append_sheet(workbook, sheet, "Expenses");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    for (const zone of ["Europe/Paris", "Asia/Seoul", "America/New_York"]) {
      process.env.TZ = zone;
      const result = await readExpenseDocument(new File([bytes], "renamed.bin"));
      assert.equal(result.tables[0].rows[1][0], "2026-09-01", zone);
      assert.equal(result.tables[0].rows[1][2], "-12.34");
    }
  } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
});
test("row and file bounds reject explicitly instead of silently truncating", async () => {
  const oversized = new File([], "big.csv"); Object.defineProperty(oversized, "size", { value: 40_000_001 });
  await assert.rejects(readExpenseDocument(oversized), /size/);
  const wb = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([["Date"]]); sheet['!ref'] = "A1:A20003"; XLSX.utils.book_append_sheet(wb, sheet, "Rows");
  await assert.rejects(readExpenseDocument(new File([XLSX.write(wb, { type: "array", bookType: "xlsx" })], "big.xlsx")), /limit/);
  const zip = zipSync({ "payload": strToU8("x".repeat(30_000_001)) }, { level: 1 });
  await assert.rejects(readExpenseDocument(new File([new Uint8Array(zip)], "big.bin")), /limit/);
});
test("unsupported binary and invalid JSON are rejected", async () => {
  await assert.rejects(readExpenseDocument(new File([new Uint8Array([0, 1, 2, 3])], "random.bin")), /unsupported/);
  await assert.rejects(readExpenseDocument(new File(['{"data":"not records"}'], "data.json")), /unsupported/);
});
test("text cell positions preserve left-to-right columns and top-to-bottom lines", () => {
  assert.deepEqual(groupTextLines([{ text: "-12.34", x: 90, y: 10, height: 10 }, { text: "Cafe", x: 10, y: 10, height: 10 }, { text: "Next", x: 10, y: 30, height: 10 }]), [["Cafe", "-12.34"], ["Next"]]);
});

test("PDF statement geometry preserves empty debit cells, dates, wrapped merchants and page boundaries", () => {
  const item = (text: string, x: number, y: number, height = 10): PositionedDocumentText => ({ text, x, y, height, width: text.length * height * .45 });
  const header = (y: number) => [item("Date", 40, y), item("Description", 130, y), item("Money out", 340, y), item("Money in", 420, y), item("Balance", 530, y)];
  const tables = extractPositionedStatementTables([
    [item("Account summary", 40, 10), item("€10,000.00", 530, 20), ...header(50), item("Sep 18, 2026", 40, 70), item("Corner", 130, 70), item("€12.34", 340, 70), item("€987.66", 530, 70), item("Coffee Shop", 130, 82), item("Card: 0000******0000", 130, 92, 6), item("Sep 19, 2026", 40, 110), item("Salary", 130, 110), item("€1000.00", 420, 110), item("€1987.66", 530, 110)],
    [...header(10), item("Sep 20, 2026", 40, 30), item("Museum", 130, 30), item("€20.00", 340, 30), item("€1967.66", 530, 30), item("Page 2 of 2", 40, 700)],
  ]);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows.length, 4);
  assert.deepEqual(tables[0].rows[1], ["Sep 18, 2026", "Corner Coffee Shop", "€12.34", "", "€987.66"]);
  assert.equal(tables[0].rows[2][2], "", "incoming money must not slide into debit");
  const result = previewExpenseDocument({ name: "bank.pdf", tables, text: "", ledger: null, scanned: false });
  assert.deepEqual(result.rows.map(row => [row.description, row.occurredOn, row.minorUnits, row.selected]), [["Corner Coffee Shop", "2026-09-18", 1234, true], ["Museum", "2026-09-20", 2000, true]]);
  assert.deepEqual(result.excluded.map(row => row.reason), ["income"]);
});

test("separate PDF reverted sections retain their cancellation status on subsequent pages", () => {
  const item = (text: string, x: number, y: number): PositionedDocumentText => ({ text, x, y, width: 50, height: 10 });
  const header = [item("Start date", 40, 40), item("Description", 160, 40), item("Money out", 340, 40), item("Money in", 450, 40)];
  const tables = extractPositionedStatementTables([
    [item("Reverted from September 1, 2023 to March 27, 2024", 40, 10), ...header, item("Sep 18, 2023", 40, 60), item("Test Cafe", 160, 60), item("€12.34", 340, 60)],
    [...header, item("Sep 19, 2023", 40, 60), item("Test Market", 160, 60), item("€8.00", 340, 60)],
  ]);
  assert.equal(tables[0].rows[0].at(-1), "Status");
  assert.equal(tables[0].rows[1].at(-1), "reverted"); assert.equal(tables[0].rows[2].at(-1), "reverted");
  const preview = previewExpenseDocument({ name: "bank.pdf", tables, text: "", ledger: null, scanned: false });
  assert.equal(preview.rows.length, 0); assert.equal(preview.excluded.length, 2);
});

test("PDF Korean headers and fragmented labels form real columns; account summaries do not form transactions", () => {
  const item = (text: string, x: number, y: number, width = 30): PositionedDocumentText => ({text,x,y,width,height:10});
  const tables = extractPositionedStatementTables([[item("거래", 40, 10, 20), item("일자", 62, 10, 20), item("가맹점명", 140, 10), item("출금금액", 320, 10), item("입금금액", 420, 10), item("잔액", 520, 10), item("2026. 9. 2.", 40, 30, 70), item("테스트 식당", 140, 30, 80), item("12,000원", 320, 30, 50), item("90,000원", 520, 30, 50)]]);
  const result = previewExpenseDocument({name:"bank.pdf",tables,text:"",ledger:null,scanned:false});
  assert.equal(result.rows[0].occurredOn, "2026-09-02"); assert.equal(result.rows[0].minorUnits, 12000);
  const summary = extractPositionedStatementTables([[item("Closing balance",40,10,100), item("€900.00",400,10,60)]]);
  assert.deepEqual(summary, []);
});
