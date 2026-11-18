import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Capacitor } from "@capacitor/core";

// Simulates the Capacitor bridge, not UIKit or Vision. Device behavior still
// requires the Mac/iPhone checks documented in the installation guide.
const bridge = Capacitor as unknown as {
  PluginHeaders?: { name: string; methods: { name: string; rtype: string }[] }[];
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
};
bridge.PluginHeaders = [{ name: "DocumentFiles", methods: ["savePdf", "sharePdf", "recognizeImage"].map(name => ({ name, rtype: "promise" })) }];
const documents = await import("../src/lib/documentFiles");

test("iPhone and Android PDF save/share use native completion, preserving cancellation and errors", async (context) => {
  let platform = "ios";
  context.mock.method(Capacitor, "getPlatform", () => platform);
  const calls: { plugin: string; method: string; options: unknown }[] = [];
  let result: unknown = { saved: true, shared: true };
  let failure: Error | undefined;
  bridge.nativePromise = async (plugin, method, options) => {
    calls.push({ plugin, method, options });
    if (failure) throw failure;
    return result;
  };
  const pdf = new Blob(["%PDF-1.7\nsynthetic"], { type: "application/pdf" });
  for (platform of ["ios", "android"]) {
    result = { saved: true, shared: true };
    assert.equal(await documents.savePdfFile(pdf, "생활.pdf"), true);
    assert.equal(await documents.sharePdfFile(pdf, "여행.pdf"), true);
    result = { saved: false, shared: false };
    assert.equal(await documents.savePdfFile(pdf, "생활.pdf"), false);
    assert.equal(await documents.sharePdfFile(pdf, "여행.pdf"), false);
    result = { saved: "true", shared: 1 };
    assert.equal(await documents.savePdfFile(pdf, "생활.pdf"), false, "a malformed native response never reports success");
    assert.equal(await documents.sharePdfFile(pdf, "여행.pdf"), false);
    failure = new Error("document-ui-unavailable");
    await assert.rejects(documents.savePdfFile(pdf, "생활.pdf"), /document-ui-unavailable/);
    await assert.rejects(documents.sharePdfFile(pdf, "여행.pdf"), /document-ui-unavailable/);
    failure = undefined;
  }
  assert.ok(calls.every(call => call.plugin === "DocumentFiles"));
  assert.deepEqual(calls[0], { plugin: "DocumentFiles", method: "savePdf", options: { filename: "생활.pdf", base64: btoa("%PDF-1.7\nsynthetic") } });
});

test("iPhone OCR preserves native positions and language; web is explicitly unsupported", async (context) => {
  let platform = "ios";
  context.mock.method(Capacitor, "getPlatform", () => platform);
  const lines = [{ text: "테스트 상점", x: 10, y: 20, height: 12, width: 80 }, { text: "12,34 €", x: 200, y: 20, height: 12, width: 45 }];
  let calls = 0;
  bridge.nativePromise = async (plugin, method, options) => {
    calls++;
    assert.equal(plugin, "DocumentFiles");
    assert.equal(method, "recognizeImage");
    assert.deepEqual(options, { base64: "AQID", language: "ko" });
    return { lines };
  };
  assert.deepEqual(await documents.recognizeImage(new Uint8Array([1, 2, 3]), "ko"), lines);
  platform = "android";
  assert.deepEqual(await documents.recognizeImage(new Uint8Array([1, 2, 3]), "ko"), lines);
  assert.equal(calls, 2);
  await assert.rejects(documents.recognizeImage(new Uint8Array(), "ko"), /^Error: size$/);
  await assert.rejects(documents.recognizeImage(new Uint8Array(40_000_001), "ko"), /^Error: size$/);
  platform = "web";
  await assert.rejects(documents.recognizeImage(new Uint8Array([1, 2, 3]), "ko"), /ocr-native-required/);
  assert.equal(calls, 2, "no native invocation for unsupported/oversized input");
});

test("iPhone unavailable OCR language is surfaced, never replaced with a silent Latin guess", async (context) => {
  context.mock.method(Capacitor, "getPlatform", () => "ios");
  bridge.nativePromise = async () => { throw new Error("ocr-language-unavailable"); };
  await assert.rejects(documents.recognizeImage(new Uint8Array([1, 2, 3]), "ko"), /ocr-language-unavailable/);
});

test("native PDF/OCR source contract keeps export callbacks, bounded local recognition and image orientation", () => {
  const native = readFileSync(new URL("../ios/App/App/DocumentFilesPlugin.swift", import.meta.url), "utf8");
  assert.match(native, /UIDocumentPickerViewController\(forExporting: \[file\], asCopy: true\)/);
  assert.match(native, /didPickDocumentsAt urls: \[URL\]/);
  assert.match(native, /finishPDF\(token: token, completed: !urls\.isEmpty\)/);
  assert.match(native, /documentPickerWasCancelled/);
  assert.match(native, /completionWithItemsHandler/);
  assert.match(native, /popoverPresentationController\?\.sourceView/);
  assert.match(native, /controller === pdfController/);
  assert.match(native, /pdfToken == token/);
  assert.match(native, /bytes\.count <= 40_000_000/);
  assert.match(native, /kCGImageSourceCreateThumbnailWithTransform: true/);
  assert.match(native, /kCGImageSourceThumbnailMaxPixelSize: 3000/);
  assert.match(native, /supportedRecognitionLanguages\(\)/);
  assert.match(native, /request\.usesLanguageCorrection = false/);
  assert.match(native, /\(1 - rect\.maxY\)/);
  assert.match(native, /observations\.count <= 10_000/);
  assert.match(native, /completeFileProtection/);
  assert.doesNotMatch(native, /URLSession|https?:\/\/|print\(|NSLog\(/);
});
