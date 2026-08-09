import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fingerprint = process.env.ANDROID_SHA256_FINGERPRINT
  ?.trim()
  .toUpperCase();
const packageId = process.env.ANDROID_PACKAGE_ID ?? "com.together.travel";

if (
  !fingerprint ||
  !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)
) {
  throw new Error(
    "ANDROID_SHA256_FINGERPRINT must be a colon-separated SHA-256 certificate fingerprint",
  );
}
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId)) {
  throw new Error(
    "ANDROID_PACKAGE_ID is not a valid lowercase Android application ID",
  );
}

const statement = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageId,
      sha256_cert_fingerprints: [fingerprint],
    },
  },
];

const outputDir = path.join(root, "android");
await mkdir(outputDir, { recursive: true });
await writeFile(
  path.join(outputDir, "assetlinks.json"),
  `${JSON.stringify(statement, null, 2)}\n`,
  "utf8",
);
console.log(`Wrote Digital Asset Links statement for ${packageId}.`);
