#!/usr/bin/env node
/**
 * Builds the command bundle with no toolchain and no dependencies.
 *
 * OpenPGP.js's browser build is a self-contained UMD with zero `require()` calls, so the bundle is
 * simply that file concatenated with the command source — no bundler, nothing to install.
 *
 * It writes `share-selected-text.js` at the repository root, because the root **is** the install
 * layout. Tinycast's "Install from GitHub" route runs this script (`npm run build`) in the folder it
 * downloaded and then installs from that same directory, copying only:
 *
 *     package.json, <command>.js, assets/
 *
 *   node build.mjs            write the bundle
 *   node build.mjs --check    fail if the committed bundle is out of date (used by CI)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(root, "vendor", "openpgp-5.11.3.min.js");
const VENDOR_SHA256 = "89ae4b15e830e08096a125003218bdc7b5c39a4075437dc8d6d4a4e3bdc9a550";
const check = process.argv.includes("--check");

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const command = manifest.commands[0].name;
const target = join(root, `${command}.js`);

// --- vendor integrity: the file is fetched by hand, so prove it is the reviewed artifact
const vendor = readFileSync(VENDOR, "utf8");
const digest = createHash("sha256").update(vendor).digest("hex");
if (digest !== VENDOR_SHA256) {
  throw new Error(
    `vendor/openpgp-5.11.3.min.js changed:\n  expected ${VENDOR_SHA256}\n  got      ${digest}`,
  );
}

// --- guards: the two portability traps this extension exists to avoid
if (!/getNodeCrypto:function\(\)\{\}/.test(vendor)) {
  throw new Error("vendor lacks the browser build's `getNodeCrypto:function(){}` stub — wrong build");
}
if (/require\(/.test(vendor)) {
  throw new Error("vendor contains require() — not the self-contained browser build");
}
// getCiphers may only appear behind the ternary that the undefined node-crypto stub short-circuits.
for (const match of vendor.match(/[A-Za-z_$][\w$]*\.getCiphers\s*\(\s*\)/g) || []) {
  const at = vendor.indexOf(match);
  const guarded = /\?\s*$/.test(vendor.slice(Math.max(0, at - 8), at));
  if (!guarded) throw new Error(`vendor calls ${match} unguarded — that is the Tinycast crash`);
}

const source = readFileSync(join(root, "src", `${command}.js`), "utf8")
  .replace(/^"use strict";\s*/, "");
const bundle = [
  '"use strict";',
  vendor.replace(/^\/\/# sourceMappingURL=.*$/m, "").trimEnd(),
  "",
  source.trimStart(),
].join("\n");

const kb = (n) => (n / 1024).toFixed(0) + " KB";

if (check) {
  const current = readFileSync(target, "utf8");
  if (current !== bundle) {
    console.error(`${command}.js is stale — run \`npm run build\` and commit the result`);
    process.exit(1);
  }
  console.log(`${command}.js is up to date (${kb(Buffer.byteLength(bundle))})`);
} else {
  writeFileSync(target, bundle);
  console.log(`built ${command}.js  (${kb(Buffer.byteLength(bundle))})`);
  console.log(`  vendor openpgp 5.11.3 browser build: ${kb(Buffer.byteLength(vendor))}, sha256 ok`);
  console.log("  install layout: package.json, " + `${command}.js` + ", assets/");
}
