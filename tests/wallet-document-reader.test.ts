import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { zipSync, strToU8 } from "fflate";
import { parseDelimited, readExpenseDocument, groupTextLines } from "../src/lib/documentReader";

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
