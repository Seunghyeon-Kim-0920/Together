import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const swiftPackage = resolve(root, "ios/App/CapApp-SPM/Package.swift");
const swift = readFileSync(swiftPackage, "utf8");
const project = readFileSync(resolve(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string };
const android = readFileSync(resolve(root, "android/app/build.gradle"), "utf8");

test("iOS Swift package local dependencies use portable paths and exist after npm ci", () => {
  const paths = [...swift.matchAll(/\.package\(name:\s*"[^"]+",\s*path:\s*"([^"]+)"\)/g)].map((match) => match[1]);
  assert.equal(paths.length, 5);
  for (const path of paths) {
    assert.ok(!path.includes("\\"), `Swift package path is not portable: ${path}`);
    assert.ok(path.startsWith("../../../node_modules/"), `Unexpected Swift package path: ${path}`);
    assert.ok(existsSync(resolve(dirname(swiftPackage), path, "Package.swift")), `Missing iOS plugin package: ${path}`);
  }
});

test("iOS app and Android builds identify the same source release", () => {
  const versions = [...project.matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)].map((match) => match[1].trim());
  const codes = [...project.matchAll(/CURRENT_PROJECT_VERSION\s*=\s*(\d+);/g)].map((match) => match[1]);
  const androidCode = /versionCode\s+(\d+)/.exec(android)?.[1];
  assert.deepEqual(versions, [manifest.version, manifest.version]);
  assert.ok(androidCode);
  assert.deepEqual(codes, [androidCode, androidCode]);
});
