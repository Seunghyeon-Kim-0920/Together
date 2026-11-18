import { Capacitor, registerPlugin } from "@capacitor/core";

interface DocumentFilesNative {
  savePdf(options: { filename: string; base64: string }): Promise<{ saved: boolean }>;
  sharePdf(options: { filename: string; base64: string }): Promise<{ shared: boolean }>;
  recognizeImage(options: { base64: string; language: string }): Promise<{ lines: { text: string; x: number; y: number; height: number; width?: number }[] }>;
}
const native = registerPlugin<DocumentFilesNative>("DocumentFiles");
export function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 8192) value += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(value);
}
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export async function savePdfFile(blob: Blob, filename: string): Promise<boolean> {
  if (hasNativeDocuments()) return (await native.savePdf({ filename, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) })).saved === true;
  download(blob, filename); return true;
}
export async function sharePdfFile(blob: Blob, filename: string): Promise<boolean> {
  if (hasNativeDocuments()) return (await native.sharePdf({ filename, base64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) })).shared === true;
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return true; }
  download(blob, filename); return false;
}
export async function recognizeImage(bytes: Uint8Array, language: string) {
  if (!hasNativeDocuments()) throw new Error("ocr-native-required");
  if (!bytes.length || bytes.length > 40_000_000) throw new Error("size");
  return (await native.recognizeImage({ base64: bytesToBase64(bytes), language })).lines;
}

function hasNativeDocuments(): boolean {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios";
}
