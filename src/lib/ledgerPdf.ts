import { formatMoney } from "./currency";
import { generalCategoryLabel, t, travelCategoryLabel } from "./i18n";
import { merchantDisplayName } from "./merchant";
import { createLedgerSharePayload, parseLedgerShareDocument, safeFilename } from "./share";
import { savePdfFile, sharePdfFile } from "./documentFiles";
import type { Ledger, Locale } from "./types";
import { newestExpensesFirst, parseLedger, settleTravelExpenses } from "./wallet";

/** A standard PDF attachment preserves exact expense IDs, participants and splits. */
export async function attachLedgerToPdf(bytes: Uint8Array, ledger: Ledger): Promise<Uint8Array> {
  const payload = createLedgerSharePayload(ledger);
  // Do not create a backup that our importer cannot restore in full.
  if (!parseLedgerShareDocument(payload)) throw new Error("ledger-attachment-limit");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.load(bytes);
  await pdf.attach(new TextEncoder().encode(payload), "wallet-diary.json", { mimeType: "application/json" });
  pdf.setTitle(ledger.title); pdf.setAuthor("지갑의 일기");
  return pdf.save();
}
export async function createLedgerPdf(ledger: Ledger, locale: Locale): Promise<{ filename: string; blob: Blob }> {
  if (!parseLedger(ledger)) throw new Error("invalid-ledger");
  if (!parseLedgerShareDocument(createLedgerSharePayload(ledger))) throw new Error("ledger-attachment-limit");
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  await document.fonts.ready;
  const report = document.createElement("div");
  report.setAttribute("aria-hidden", "true");
  report.dataset.ledgerPdf = "true";
  Object.assign(report.style, { position: "absolute", left: "-12000px", top: "0", width: "794px", fontFamily: 'Arial, "Noto Sans KR", sans-serif', color: "#102a37", background: "#ffffff", lineHeight: "1.5", fontSize: "15px" });
  document.body.append(report);
  const pages: HTMLElement[] = [];
  let page: HTMLElement;
  const text = (tag: string, value: string, styles: Partial<CSSStyleDeclaration> = {}) => {
    const element = document.createElement(tag); element.textContent = value; Object.assign(element.style, { margin: "0", minWidth: "0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...styles }); return element;
  };
  const newPage = () => {
    page = document.createElement("section");
    Object.assign(page.style, { width: "794px", height: "1123px", padding: "40px", boxSizing: "border-box", background: "#ffffff", position: "relative" });
    page.append(text("div", locale === "ko" ? "지갑의 일기" : locale === "fr" ? "Journal du portefeuille" : "Wallet Diary", { color: "#008d61", fontSize: "15px", fontWeight: "700" }));
    page.append(text("h1", ledger.title.replace(/\s+/g, " "), { fontSize: "25px", lineHeight: "1.3", marginBottom: "8px" }));
    report.append(page); pages.push(page);
  };
  const add = (block: HTMLElement, keepNext = 0) => {
    page.append(block);
    if (block.offsetTop + block.offsetHeight + keepNext > 1068) {
      block.remove(); newPage(); page.append(block);
    }
    if (block.offsetTop + block.offsetHeight > 1068) throw new Error("pdf-row-overflow");
  };
  const heading = (value: string) => add(text("h2", value, { fontSize: "18px", color: "#007c58", padding: "14px 0 6px", borderBottom: "1px solid #cddcd7" }), 42);
  const rowElement = (values: string[], widths: string, detail: boolean) => {
    const element = document.createElement("div");
    Object.assign(element.style, { display: "grid", gridTemplateColumns: widths, gap: "10px", padding: detail ? "3px 0 3px 18px" : "10px 0", borderBottom: detail ? "none" : "1px solid #e4ece9", alignItems: "start", fontSize: detail ? "12px" : "14px", color: detail ? "#62716c" : "#102a37" });
    values.forEach((value, index) => element.append(text("div", value, values.length > 1 && index === values.length - 1 ? { textAlign: "right", fontWeight: "700" } : {})));
    return element;
  };
  const row = (values: string[], widths: string, detail = false) => {
    let remaining = values;
    while (remaining.some((value) => value.length)) {
      const element = rowElement(remaining, widths, detail); page.append(element);
      if (element.offsetTop + element.offsetHeight <= 1068) return;
      // Prefer keeping an ordinary expense together on the next page.
      if (page.children.length > 3) { element.remove(); newPage(); page.append(element); }
      if (element.offsetTop + element.offsetHeight <= 1068) return;
      // Unusually long multiline descriptions can exceed a whole page.
      // Fit each column by measured height and carry every remaining character.
      const maximumHeight = 1068 - element.offsetTop;
      const cells = Array.from(element.children) as HTMLElement[];
      const tail = remaining.map((value, index) => {
        const points = Array.from(value); const cell = cells[index];
        let low = 0; let high = points.length;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2); cell.textContent = points.slice(0, middle).join("");
          if (cell.offsetHeight + (detail ? 6 : 21) <= maximumHeight) low = middle; else high = middle - 1;
        }
        cell.textContent = points.slice(0, low).join("");
        return points.slice(low).join("");
      });
      if (tail.every((value, index) => value === remaining[index]) || element.offsetTop + element.offsetHeight > 1068) throw new Error("pdf-row-overflow");
      remaining = tail;
      if (remaining.some((value) => value.length)) newPage();
    }
  };
  try {
    newPage();
    add(text("p", t(locale, ledger.kind === "travel" ? "travelLedger" : "generalLedger"), { color: "#63726d", marginBottom: "6px" }));
    const dates = ledger.expenses.map((expense) => expense.occurredOn).sort();
    if (dates.length) add(text("p", dates[0] + " - " + dates[dates.length - 1], { color: "#63726d" }));
    heading(t(locale, "totalSpent"));
    const currencies = ledger.kind === "general" ? [ledger.currency] : ledger.currencies;
    for (const currency of currencies) {
      const total = ledger.expenses.filter((expense) => expense.currency === currency).reduce((sum, expense) => sum + expense.minorUnits, 0);
      if (!Number.isSafeInteger(total)) throw new Error("amount-overflow");
      row([currency, formatMoney(total, currency, locale)], "1fr 220px");
    }
    if (ledger.kind === "travel") {
      const names = new Map(ledger.participants.map((person) => [person.id, person.name]));
      heading(t(locale, "participants"));
      for (const person of ledger.participants) row([person.name], "1fr", true);
      heading(t(locale, "settlement"));
      const transfers = settleTravelExpenses(ledger).flatMap((item) => item.transfers);
      if (!transfers.length) add(text("p", t(locale, "settlementEmpty"), { padding: "10px 0" }));
      for (const transfer of transfers) row([String(names.get(transfer.from)) + " → " + String(names.get(transfer.to)), formatMoney(transfer.minorUnits, transfer.currency, locale)], "1fr 180px");
      heading(t(locale, "history"));
      for (const expense of newestExpensesFirst(ledger.expenses)) {
        row([expense.occurredOn, expense.description + "\n" + travelCategoryLabel(locale, expense.category), String(names.get(expense.paidBy)), formatMoney(expense.minorUnits, expense.currency, locale)], "90px 1fr 105px 120px");
        for (const share of expense.shares) row([t(locale, "splitWith") + ": " + String(names.get(share.participantId)), formatMoney(share.minorUnits, expense.currency, locale)], "1fr 150px", true);
      }
    } else {
      heading(t(locale, "categorySpending"));
      const totals = new Map<string, number>();
      for (const expense of ledger.expenses) totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.minorUnits);
      for (const [category, amount] of totals) row([generalCategoryLabel(locale, category as (typeof ledger.expenses)[number]["category"]), formatMoney(amount, ledger.currency, locale)], "1fr 180px");
      heading(t(locale, "history"));
      for (const expense of newestExpensesFirst(ledger.expenses)) row([expense.occurredOn, merchantDisplayName(expense.description, expense.id), generalCategoryLabel(locale, expense.category), formatMoney(expense.minorUnits, expense.currency, locale)], "90px 1fr 105px 120px");
    }
    if (!ledger.expenses.length) add(text("p", t(locale, "noExpenses")));
    const pdf = new jsPDF({ format: "a4", unit: "mm", compress: true });
    for (let index = 0; index < pages.length; index++) {
      const footer = text("div", String(index + 1) + " / " + String(pages.length), { position: "absolute", bottom: "16px", right: "40px", color: "#71827a", fontSize: "12px" }); pages[index].append(footer);
      const canvas = await html2canvas(pages[index], { scale: 1.5, backgroundColor: "#ffffff", logging: false });
      if (index) pdf.addPage(); pdf.addImage(canvas.toDataURL("image/jpeg", .9), "JPEG", 0, 0, 210, 297, undefined, "FAST");
      canvas.width = 0; canvas.height = 0;
    }
    const bytes = await attachLedgerToPdf(new Uint8Array(pdf.output("arraybuffer")), ledger);
    if (bytes.byteLength > 40_000_000) throw new Error("pdf-file-limit");
    return { filename: safeFilename(ledger.title) + ".pdf", blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }) };
  } finally { report.remove(); }
}
export async function saveLedgerPdf(ledger: Ledger, locale: Locale): Promise<boolean> {
  const file = await createLedgerPdf(ledger, locale); return savePdfFile(file.blob, file.filename);
}
export async function shareLedgerPdf(ledger: Ledger, locale: Locale): Promise<boolean> {
  const file = await createLedgerPdf(ledger, locale); return sharePdfFile(file.blob, file.filename);
}
