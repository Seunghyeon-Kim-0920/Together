import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { attachLedgerToPdf, isValidPdfDateRange, ledgerForPdf, ledgerPdfFilename } from "../src/lib/ledgerPdf";
import { bytesToBase64, sharePdfFile } from "../src/lib/documentFiles";
import { parseLedgerShareDocument } from "../src/lib/share";
import { createLedger } from "../src/lib/wallet";
import type { GeneralLedger, TravelLedger } from "../src/lib/types";

async function emptyPdf(): Promise<Uint8Array> { const pdf = await PDFDocument.create(); pdf.addPage(); return pdf.save(); }
async function attachment(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const names = pdf.catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"), PDFArray);
  const specification = names.lookup(1, PDFDict);
  const stream = specification.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
  assert.ok(stream instanceof PDFRawStream);
  return { pdf, filename: specification.lookup(PDFName.of("UF"), PDFHexString).decodeText(), text: new TextDecoder().decode(decodePDFRawStream(stream).decode()) };
}

test("a real PDF attachment preserves travel IDs, Unicode names, exact payer and shares", async () => {
  const ledger: TravelLedger = { ...createLedger("travel", "파리 · été", "EUR"), participants: [{ id: "alice", name: "승현" }, { id: "bob", name: "François" }], selfParticipantId: "alice", expenses: [{ id: "expense-1", description: "카페 Café", category: "food", currency: "EUR", minorUnits: 3001, paidBy: "alice", occurredOn: "2026-09-01", shares: [{ participantId: "alice", minorUnits: 1501 }, { participantId: "bob", minorUnits: 1500 }] }] };
  const result = await attachment(await attachLedgerToPdf(await emptyPdf(), ledger));
  assert.equal(result.pdf.getPageCount(), 1);
  assert.equal(result.filename, "wallet-diary.json");
  const parsed = parseLedgerShareDocument(result.text);
  assert.equal(parsed?.sourceLedgerId, ledger.id);
  assert.deepEqual(parsed?.ledger.expenses, ledger.expenses);
  assert.equal(parsed?.ledger.kind === "travel" && parsed.ledger.selfParticipantId, null);
  assert.deepEqual(parsed?.ledger.kind === "travel" && parsed.ledger.participants, ledger.participants);
});

test("general PDF attachments omit local card and budget settings, preserving exact spending", async () => {
  const ledger: GeneralLedger = { ...createLedger("general", "생활", "EUR"), monthlyLimitMinor: 10000, automationAllApps: true, automationSources: [{ packageName: "secret.bank", displayName: "Secret", trustedDirectApp: true }], expenses: [{ id: "manual-expense", description: "Boulangerie", category: "food", currency: "EUR", minorUnits: 124, occurredOn: "2026-09-01", automationFingerprint: "card-origin-1234567890abcdef" }] };
  const { text } = await attachment(await attachLedgerToPdf(await emptyPdf(), ledger));
  assert.equal(text.includes("secret.bank"), false);
  assert.equal(text.includes("card-origin"), false);
  assert.equal(text.includes("monthlyLimitMinor"), false);
  const parsed = parseLedgerShareDocument(text);
  assert.equal(parsed?.ledger.expenses[0].minorUnits, 124);
  assert.equal(parsed?.ledger.expenses[0].description, "Boulangerie");
});

test("oversized or malformed attachments fail instead of producing an unrestorable backup", async () => {
  const ledger: GeneralLedger = { ...createLedger("general", "Large", "EUR"), expenses: Array.from({ length: 2000 }, (_, index) => ({ id: String(index), description: "가".repeat(500), category: "food", currency: "EUR", minorUnits: 1, occurredOn: "2026-09-01" })) };
  await assert.rejects(attachLedgerToPdf(await emptyPdf(), ledger), /ledger-attachment-limit/);
  await assert.rejects(attachLedgerToPdf(await emptyPdf(), { ...ledger, expenses: [{ ...ledger.expenses[0], minorUnits: -1 }] }), /ledger-attachment-limit/);
});

test("web PDF sharing hands the target a .pdf application/pdf file with intact bytes", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let received: File | undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { canShare: () => true, share: async ({ files }: { files: File[] }) => { received = files[0]; } } });
  try {
    const bytes = await emptyPdf();
    assert.equal(await sharePdfFile(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), "파리.pdf"), true);
    assert.equal(received?.name, "파리.pdf");
    assert.equal(received?.type, "application/pdf");
    assert.deepEqual(new Uint8Array(await received!.arrayBuffer()), bytes);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor); else Reflect.deleteProperty(globalThis, "navigator");
  }
});

function periodLedger(): GeneralLedger {
  return { ...createLedger("general", "Period test", "EUR"), expenses: [
    { id: "before", description: "Outside before", category: "shopping", currency: "EUR", minorUnits: 9999, occurredOn: "2024-02-27" },
    { id: "start", description: "Start restaurant", category: "food", currency: "EUR", minorUnits: 100, occurredOn: "2024-02-28" },
    { id: "leap", description: "Leap bus", category: "transport", currency: "EUR", minorUnits: 200, occurredOn: "2024-02-29" },
    { id: "end", description: "End cafe", category: "food", currency: "EUR", minorUnits: 300, occurredOn: "2024-03-01" },
    { id: "after", description: "Outside after", category: "housing", currency: "EUR", minorUnits: 8888, occurredOn: "2024-03-02" },
  ] };
}

test("general PDF ranges include both boundaries and leap day without mutating saved expenses", () => {
  const ledger = periodLedger(); const original = JSON.stringify(ledger);
  const selected = ledgerForPdf(ledger, { from: "2024-02-28", to: "2024-03-01" });
  assert.deepEqual(selected.expenses.map((expense) => expense.id), ["start", "leap", "end"]);
  assert.equal(selected.expenses.reduce((sum, expense) => sum + expense.minorUnits, 0), 600);
  const totals = Object.fromEntries(["food", "transport", "housing", "shopping"].map((category) => [category, selected.expenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + expense.minorUnits, 0)]));
  assert.deepEqual(totals, { food: 400, transport: 200, housing: 0, shopping: 0 });
  assert.equal(JSON.stringify(ledger), original);
  assert.notEqual(selected.expenses, ledger.expenses);
  assert.equal(ledgerForPdf(ledger), ledger);
});

test("PDF date ranges reject malformed, rollover and reversed dates before filtering", () => {
  const ledger = periodLedger();
  for (const range of [
    { from: "2024-03-01", to: "2024-02-28" },
    { from: "2025-02-29", to: "2025-03-01" },
    { from: "2024-04-31", to: "2024-05-01" },
    { from: "2024-02-28T00:00:00Z", to: "2024-03-01" },
    { from: "2024-2-28", to: "2024-03-01" },
    { from: "", to: "2024-03-01" },
  ]) {
    assert.equal(isValidPdfDateRange(range), false);
    assert.throws(() => ledgerForPdf(ledger, range), /invalid-pdf-date-range/);
    assert.throws(() => ledgerPdfFilename(ledger, range), /invalid-pdf-date-range/);
  }
  assert.equal(isValidPdfDateRange({ from: "2024-02-29", to: "2024-02-29" }), true);
  assert.deepEqual(ledgerForPdf(ledger, { from: "2024-02-29", to: "2024-02-29" }).expenses.map((expense) => expense.id), ["leap"]);
  assert.throws(() => ledgerForPdf({ ...ledger, expenses: [{ ...ledger.expenses[0], occurredOn: "2024-02-30" }] }, { from: "2024-03-01", to: "2024-03-02" }), /invalid-ledger/);
});

test("filtered PDF attachments contain no dates, merchants or totals outside the requested period", async () => {
  const ledger = periodLedger(); const original = JSON.stringify(ledger);
  const range = { from: "2024-02-28", to: "2024-03-01" };
  const { text } = await attachment(await attachLedgerToPdf(await emptyPdf(), ledger, range));
  for (const privateValue of ["Outside before", "Outside after", "2024-02-27", "2024-03-02", "9999", "8888"]) assert.equal(text.includes(privateValue), false);
  const restored = parseLedgerShareDocument(text)?.ledger;
  assert.ok(restored);
  assert.deepEqual(restored.expenses.map((expense) => expense.occurredOn), ["2024-02-28", "2024-02-29", "2024-03-01"]);
  assert.equal(restored.expenses.reduce((sum, expense) => sum + expense.minorUnits, 0), 600);
  assert.equal(ledgerPdfFilename(ledger, range), "Period test_2024-02-28_2024-03-01.pdf");
  assert.equal(JSON.stringify(ledger), original);
});

test("an empty custom period remains an empty restorable PDF and its filename retains the selected dates", async () => {
  const ledger = periodLedger(); const range = { from: "2026-01-01", to: "2026-12-31" };
  assert.equal(ledgerForPdf(ledger, range).expenses.length, 0);
  const { text } = await attachment(await attachLedgerToPdf(await emptyPdf(), ledger, range));
  assert.deepEqual(parseLedgerShareDocument(text)?.ledger.expenses, []);
  assert.equal(ledgerPdfFilename(ledger, range), "Period test_2026-01-01_2026-12-31.pdf");
  assert.equal(ledgerPdfFilename(ledger), "Period test.pdf");
});

test("travel PDF exports keep their existing full-ledger default and reject a general-only range", () => {
  const ledger = createLedger("travel", "Trip", "EUR");
  assert.equal(ledgerForPdf(ledger), ledger);
  assert.equal(ledgerPdfFilename(ledger), "Trip.pdf");
  assert.throws(() => ledgerForPdf(ledger, { from: "2024-02-28", to: "2024-03-01" }), /invalid-pdf-date-range/);
});
