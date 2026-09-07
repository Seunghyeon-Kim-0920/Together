import assert from "node:assert/strict";
import test from "node:test";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { attachLedgerToPdf } from "../src/lib/ledgerPdf";
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
