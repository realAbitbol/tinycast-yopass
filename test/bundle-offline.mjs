#!/usr/bin/env node
/**
 * Runs the BUILT bundle offline, in a global that mirrors Tinycast's extension host: a `crypto` shim
 * with `getRandomValues` and **no `subtle`**, a stubbed `@raycast/api`, a stubbed `fetch`. Then it
 * decrypts what the bundle posted, with the vendored OpenPGP.js, the way a recipient would.
 *
 * No network, no app, no dependencies.
 *
 *   node test/bundle-offline.mjs [extensionDir]
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = resolve(process.argv[2] ?? root);

const TEXT = "hello from the offline suite — accents éàü and a ✓";
const SECRET_ID = "P8hVhF7nAd4kQ2sLwC0aUw";
const PREFS = {
  url: "https://yopass.example.com",
  apiUrl: "https://api.yopass.example.com/", // trailing slash on purpose: the source trims it
  duration: "86400",
  oneTime: true,
};

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  \u001b[32mok\u001b[0m   ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  \u001b[31mFAIL\u001b[0m ${label}\n       ${error.message}`);
  }
}

/** Tinycast's `crypto`: hashes/HMAC/PBKDF2/AES/random/UUID, no `subtle`, no `getCiphers`. */
function installTinycastCrypto() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const shim = {
    subtle: undefined,
    randomUUID: () => randomUUID(),
    getRandomValues(view) {
      if (!ArrayBuffer.isView(view)) throw new TypeError("Expected an integer TypedArray");
      if (view.byteLength > 65536) throw new Error("QuotaExceededError");
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength).set(randomBytes(view.byteLength));
      return view;
    },
  };
  Object.defineProperty(globalThis, "crypto", { value: shim, configurable: true, writable: true });
  return () => Object.defineProperty(globalThis, "crypto", previous);
}

/** The vendor file is `var openpgp = (function(){…})()`, so evaluating it can return the namespace. */
function loadVendoredOpenpgp() {
  const source = readFileSync(join(root, "vendor", "openpgp-5.11.3.min.js"), "utf8");
  // `new Function` on a file from this repository, never on anything interpolated from outside it:
  // it is how the Tinycast runtime itself compiles an extension (`__tinycastCompile`), and the file's
  // sha256 is pinned in build.mjs. Nothing here is attacker-controlled.
  return new Function(`${source}\nreturn openpgp;`)();
}

function readBundle() {
  const manifest = JSON.parse(readFileSync(join(extDir, "package.json"), "utf8"));
  const command = manifest.commands[0];
  return {
    manifest,
    command,
    source: readFileSync(join(extDir, `${command.name}.js`), "utf8"),
  };
}

/** Loads the bundle and runs the command once against stubs; returns what the host would have seen. */
async function run({ prefs = PREFS, selected = "", fallbackText } = {}) {
  const { command, source } = readBundle();
  const huds = [];
  const clipboard = [];
  const fetches = [];

  const api = {
    getSelectedText: async () => selected,
    getPreferenceValues: () => prefs,
    Clipboard: { copy: async (text) => (clipboard.push(text), true) },
    showHUD: async (title, options) => (huds.push({ title, options }), true),
  };
  const requireStub = (name) => {
    if (name !== "@raycast/api") {
      throw new Error(`the bundle required ${name}; everything else must be inlined`);
    }
    return api;
  };

  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    fetches.push({ url: String(url), options });
    return { status: 200, ok: true, async json() { return { message: SECRET_ID }; } };
  };

  const restoreCrypto = installTinycastCrypto();
  try {
    const module_ = { exports: {} };
    // Same reason as loadVendoredOpenpgp: the file being compiled is this repository's own built
    // bundle, at the path the installer uses. No external input reaches the function body.
    new Function("exports", "require", "module", "__filename", "__dirname", source)(
      module_.exports,
      requireStub,
      module_,
      `${command.name}.js`,
      extDir,
    );
    const main = module_.exports.default ?? module_.exports;
    assert.equal(typeof main, "function", "a no-view command must export a function");
    await main(fallbackText === undefined ? {} : { fallbackText });
    return { huds, clipboard, fetches };
  } finally {
    restoreCrypto();
    globalThis.fetch = previousFetch;
  }
}

const openpgp = loadVendoredOpenpgp();
const KEY = new RegExp(`^${PREFS.url.replace(/\./g, "\\.")}/#/s/${SECRET_ID}/([A-Za-z0-9]{22})$`);

console.log(`bundle: ${join(extDir, "share-selected-text.js")}`);

// ---------------------------------------------------------------- the happy path
const happy = await run({ selected: TEXT });

check("one HUD, reporting a one-time link", () => {
  assert.deepEqual(happy.huds.map((h) => h.title), ["🔗 Link copied (one-time)"]);
});
check("the link is <url>/#/s/<id>/<22-char key> with the trailing slash trimmed", () => {
  assert.equal(happy.clipboard.length, 1);
  assert.match(happy.clipboard[0], KEY);
});
check("one POST, to <apiUrl>/create/secret", () => {
  assert.equal(happy.fetches.length, 1);
  assert.equal(happy.fetches[0].url, "https://api.yopass.example.com/create/secret");
  assert.equal(happy.fetches[0].options.method, "POST");
  assert.equal(happy.fetches[0].options.headers["Content-Type"], "application/json");
});
check("the body carries the manifest defaults' shape: expiration, one_time, armored message", () => {
  const body = JSON.parse(happy.fetches[0].options.body);
  assert.deepEqual(Object.keys(body).sort(), ["expiration", "message", "one_time"]);
  assert.equal(body.expiration, 86400);
  assert.equal(body.one_time, true);
  assert.match(body.message, /^-----BEGIN PGP MESSAGE-----/);
  assert.match(body.message, /-----END PGP MESSAGE-----\s*$/);
});

const key = KEY.exec(happy.clipboard[0])[1];
const armored = JSON.parse(happy.fetches[0].options.body).message;

check("the recipient decrypts the posted ciphertext with the key from the link", async () => {
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const { data } = await openpgp.decrypt({ message, passwords: [key], format: "utf8" });
  assert.equal(data, TEXT);
});
check("a wrong key does not decrypt it", async () => {
  const message = await openpgp.readMessage({ armoredMessage: armored });
  await assert.rejects(() =>
    openpgp.decrypt({ message, passwords: ["Zz".repeat(11)], format: "utf8" }),
  );
});

// ---------------------------------------------------------------- the variants
const weekOneTime = await run({
  prefs: { ...PREFS, duration: "604800", oneTime: "false" },
  selected: TEXT,
});

check('duration and oneTime are honoured ("false" as a string counts as off)', () => {
  const body = JSON.parse(weekOneTime.fetches[0].options.body);
  assert.equal(body.expiration, 604800);
  assert.equal(body.one_time, false);
  assert.deepEqual(weekOneTime.huds.map((h) => h.title), ["🔗 Link copied"]);
});

const noSelection = await run({ selected: "" });

check("nothing selected: a HUD, no request, nothing copied", () => {
  assert.deepEqual(noSelection.huds.map((h) => h.title), ["❌ Select some text first"]);
  assert.equal(noSelection.fetches.length, 0);
  assert.equal(noSelection.clipboard.length, 0);
});

const viaDeeplink = await run({ selected: "", fallbackText: "from a deeplink" });

check("a deeplink's fallbackText is used when nothing is selected", async () => {
  const message = await openpgp.readMessage({
    armoredMessage: JSON.parse(viaDeeplink.fetches[0].options.body).message,
  });
  const viaKey = KEY.exec(viaDeeplink.clipboard[0])[1];
  const { data } = await openpgp.decrypt({ message, passwords: [viaKey], format: "utf8" });
  assert.equal(data, "from a deeplink");
});

// ---------------------------------------------------------------- bundle hygiene
const { source: bundle, command } = readBundle();

check("the bundle is a strict-mode, self-contained command file", () => {
  assert.ok(bundle.startsWith('"use strict";\n'), "must start with a use-strict directive");
  assert.ok(bundle.length > 500_000, "the browser openpgp build must be inlined");
});
check("its only require() is @raycast/api", () => {
  const requires = bundle.match(/require\(/g) ?? [];
  assert.equal(requires.length, 1, `found ${requires.length} require() calls`);
  assert.match(bundle, /require\("@raycast\/api"\)/);
});
check("no unguarded getCiphers() — the crash this extension exists to avoid", () => {
  for (const match of bundle.match(/[A-Za-z_$][\w$]*\.getCiphers\s*\(\s*\)/g) ?? []) {
    const at = bundle.indexOf(match);
    assert.ok(
      /\?\s*$/.test(bundle.slice(Math.max(0, at - 8), at)),
      `${match} is not behind the dead node-crypto branch`,
    );
  }
});
check("the command name in the manifest matches the file that was loaded", () => {
  assert.equal(command.name, "share-selected-text");
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
