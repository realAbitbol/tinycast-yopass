#!/usr/bin/env node
/**
 * Runs the built command bundle inside Tinycast's REAL runtime
 * (/Applications/Tinycast.app/Contents/Resources/RaycastRuntime.generated.js), driven from Node by a
 * host stub, then decrypts the produced link's secret with the recipient's own OpenPGP code and
 * deletes the secret it created.
 *
 * This is the faithful reproduction of the environment that breaks the store extension: the real
 * @raycast/api shim, the real crypto shim (no getCiphers, no subtle), the real module loader, the
 * real host-bridged fetch.
 *
 * Not part of `npm test`: it needs macOS, the Tinycast app, and an instance you are allowed to write
 * to. Point it at a local instance unless you own the one you name.
 *
 *   YOPASS_URL=http://127.0.0.1:1337 YOPASS_UI_CHUNK=/path/to/crypto-<hash>.js \
 *     node test/run-in-tinycast-runtime.mjs [extensionDir]
 *
 * Env: YOPASS_URL, YOPASS_API_URL (defaults to YOPASS_URL), YOPASS_UI_CHUNK,
 *      YOPASS_UI_PARSE, YOPASS_UI_DECRYPT (pin the chunk's minified export names),
 *      EXT_TEST_TEXT, EXT_TEST_NO_SELECTION=1, EXT_TEST_PREFS='{"preferences":{...}}'
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RAW_ENV = { ...process.env }; // the runtime replaces process.env with the boot-provided copy
const RUNTIME = "/Applications/Tinycast.app/Contents/Resources/RaycastRuntime.generated.js";
const extDir = process.argv[2] || join(import.meta.dirname, "..");
const URL_BASE = (RAW_ENV.YOPASS_URL || "http://127.0.0.1:1337").replace(/\/+$/, "");
const API_BASE = (RAW_ENV.YOPASS_API_URL || URL_BASE).replace(/\/+$/, "");
const manifest = JSON.parse(readFileSync(join(extDir, "package.json"), "utf8"));
const command = manifest.commands[0].name;
const bundle = readFileSync(join(extDir, `${command}.js`), "utf8");

const prefs = {
  url: URL_BASE,
  apiUrl: API_BASE,
  duration: "86400",
  oneTime: 1,
  ...(JSON.parse(RAW_ENV.EXT_TEST_PREFS || "{}").preferences || {}),
};
const PAYLOAD = RAW_ENV.EXT_TEST_TEXT || "tinycast runtime probe | accents éàü";
const SELECTED = RAW_ENV.EXT_TEST_NO_SELECTION === "1" ? "" : PAYLOAD;

// ---------------------------------------------------------------- primitives
// The runtime replaces globalThis.{console,setTimeout,process,...} with host-bridged shims,
// so capture what the harness and the host stub need before it is evaluated.
const rawExit = process.exit.bind(process);
const rawWrite = process.stdout.write.bind(process.stdout);
const rawWriteErr = process.stderr.write.bind(process.stderr);
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
const timers = new Map();

const clip = (line) => (line.length > 300 ? line.slice(0, 300) + ` …[${line.length} chars]` : line);
const print = (...parts) => rawWrite(clip(parts.join(" ")) + "\n");
const printErr = (...parts) => rawWriteErr(clip(parts.join(" ")) + "\n");

/**
 * Stand-in for the host's URLSession: node:http(s), NOT undici. undici needs
 * `setTimeout(...).unref()`, and the runtime's timer shim returns a numeric id, so undici cannot
 * run under it — in the app this call is native Swift anyway.
 */
function httpFetch(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "http:" ? http : https;
    const request = lib.request(
      {
        hostname: target.hostname,
        port: target.port || undefined,
        path: target.pathname + target.search,
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            statusText: response.statusMessage || "",
            headers: response.headers,
            body: Buffer.concat(chunks),
            url,
          }));
      });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

// JavaScriptCore has no fetch, so the runtime installs its own host-bridged one. Node DOES define
// fetch, which would silently keep the extension on undici; drop it so the harness exercises the
// same path the app does.
delete globalThis.fetch;

// ---------------------------------------------------------------- host stub
const calls = { clipboard: null, huds: [], toasts: [], fetches: [], unknown: [] };
let settle;
const finished = new Promise((resolve) => { settle = resolve; });
const b64 = (buf) => Buffer.from(buf).toString("base64");

globalThis.__tinycastHost = {
  invoke(id, domain, method, argsJSON) {
    const args = JSON.parse(argsJSON || "[]");
    const done = (value) => globalThis.__tinycast.settle(String(id), true, value === undefined ? undefined : JSON.stringify(value));
    const fail = (message) => globalThis.__tinycast.settle(String(id), false, String(message));
    (async () => {
      switch (`${domain}.${method}`) {
        case "clipboard.copy":
          calls.clipboard = args[0] && args[0].text;
          return done(true);
        case "clipboard.readText":
        case "clipboard.read":
          return done({ text: "" });
        case "feedback.showHUD":
          calls.huds.push(args[0]);
          return done(true);
        case "feedback.showToast":
          calls.toasts.push(args[0]);
          return done(true);
        case "feedback.hideToast":
        case "window.close":
        case "window.popToRoot":
        case "window.clearSearchBar":
          return done(true);
        case "system.selectedText":
          return done(SELECTED);
        case "fetch.request": {
          const [{ url, method, headers, bodyBase64 }] = args;
          calls.fetches.push(`${method} ${url}`);
          const response = await httpFetch(url, {
            method,
            headers,
            body: bodyBase64 ? Buffer.from(bodyBase64, "base64") : undefined,
          });
          return done({
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            bodyBase64: b64(response.body),
            url: response.url,
          });
        }
        default:
          calls.unknown.push(`${domain}.${method}`);
          return fail(`${domain}.${method} not stubbed`);
      }
    })().catch((e) => fail(e && e.message));
  },
  invokeSync(domain, method, argsJSON) {
    const args = JSON.parse(argsJSON || "[]");
    const ok = (value) => JSON.stringify({ ok: true, value });
    switch (`${domain}.${method}`) {
      case "crypto.random":
        return ok(b64(randomBytes(args[0] | 0)));
      case "crypto.hash":
        return ok(b64(createHash(args[0]).update(Buffer.from(args[1], "base64")).digest()));
      case "crypto.uuid":
        return ok(globalThis.crypto.randomUUID());
      default:
        calls.unknown.push(`SYNC ${domain}.${method}`);
        return JSON.stringify({ ok: false, error: `${domain}.${method} not stubbed` });
    }
  },
  log: (level, message) => print(`  [ext:${level}] ${message}`),
  startTimer: (id, delay, repeats) => {
    const fire = () => globalThis.__tinycast.fireTimer(id);
    timers.set(id, repeats ? realSetInterval(fire, delay) : realSetTimeout(fire, delay));
  },
  clearTimer: (id) => {
    const handle = timers.get(id);
    if (handle === undefined) return;
    timers.delete(id);
    realClearInterval(handle);
  },
  render: () => {},
  failed: (id, message) => { printErr("  host.failed:", message); settle(); },
  navigationDepthChanged: () => {},
  finished: () => settle(),
  fieldCommand: () => {},
};

globalThis.__tinycastCompile = (source, filename) =>
  new Function("exports", "require", "module", "__filename", "__dirname", source);

// ---------------------------------------------------------------- boot the real runtime
new Function(readFileSync(RUNTIME, "utf8"))();
const tinycast = globalThis.__tinycast;

tinycast.boot(JSON.stringify({
  node: { platform: "darwin", arch: "arm64", cwd: extDir, homedir: homedir(), tmpdir: "/tmp", env: RAW_ENV },
  preferences: prefs,
  environment: { extensionName: manifest.name, commandName: command, supportPath: join(extDir, "support"), assetsPath: join(extDir, "assets") },
}));

print(`runtime: ${RUNTIME.split("/").pop()}`);
print(`command: ${manifest.name}/${command} (mode ${manifest.commands[0].mode})`);
print(`prefs:   ${JSON.stringify(prefs)}`);
print(`text:    ${SELECTED ? JSON.stringify(SELECTED) : "(nothing selected)"}`);
print("");

tinycast.start("1", bundle, `${command}.js`, extDir, "no-view", JSON.stringify({ launchProps: {} }));

await new Promise((resolve) => realSetTimeout(resolve, 300));
await finished;

print("HUDs:", JSON.stringify(calls.huds));
print("host fetches:", calls.fetches.join(", ") || "(none)");
if (calls.unknown.length) print("unstubbed host calls:", calls.unknown.join(", "));

const link = calls.clipboard;
print("clipboard:", link || "(nothing copied)");
if (!link) rawExit(1);

// Verify against the live server using the recipient's own openpgp (the frontend's chunk). The link
// names the *web UI* origin, which on a split-origin instance is not the API (yopass.se is docs,
// share.yopass.se is the app, api.yopass.se is the API) — so read and delete through the API base.
const match = /^(.+)\/#\/s\/([^/]+)\/(.+)$/.exec(link);
if (!match) { printErr("link does not match <url>/#/s/<id>/<key>"); rawExit(1); }
const [, , id, key] = match;
const ui = RAW_ENV.YOPASS_UI_CHUNK
  ? await import(pathToFileURL(RAW_ENV.YOPASS_UI_CHUNK).href)
  : null;
if (!ui) { print("YOPASS_UI_CHUNK not set — skipping the recipient decrypt check"); rawExit(0); }
const fetched = JSON.parse((await httpFetch(`${API_BASE}/secret/${id}`)).body.toString("utf8"));

/**
 * The frontend chunk's export names are minified and differ per build (one deployment exposes
 * s()/c(), another i()/o()), so find the parse+decrypt pair by using it instead of guessing.
 * YOPASS_UI_PARSE / YOPASS_UI_DECRYPT pin the names when you already know them.
 */
async function decryptWithFrontend(ui, armoredMessage, key) {
  const functions = Object.entries(ui).filter(([, value]) => typeof value === "function");
  const only = (name) => (name && ui[name] ? [[name, ui[name]]] : functions);
  const errors = [];
  for (const [parseName, parseFn] of only(RAW_ENV.YOPASS_UI_PARSE)) {
    let message;
    try {
      message = await parseFn({ armoredMessage });
    } catch (error) {
      errors.push(`${parseName}: ${error.message}`);
      continue;
    }
    if (!message || typeof message !== "object") continue;
    for (const [decryptName, decryptFn] of only(RAW_ENV.YOPASS_UI_DECRYPT)) {
      if (decryptFn === parseFn) continue;
      try {
        const out = await decryptFn({ message, passwords: [key], format: "utf8" });
        const value = typeof out === "string" ? out : out && out.data;
        if (typeof value === "string") {
          print(`frontend oracle: ${parseName}() then ${decryptName}()`);
          return value;
        }
      } catch (error) {
        errors.push(`${decryptName}: ${error.message}`);
      }
    }
  }
  throw new Error(`no parse/decrypt pair in this chunk worked — ${errors.slice(0, 6).join(" | ")}`);
}

const text = await decryptWithFrontend(ui, fetched.message, key);
print("recipient decrypt matches selected text:", text === SELECTED);
const cleanup = await httpFetch(`${API_BASE}/secret/${id}`, { method: "DELETE" });
print("secret deleted from the instance:", cleanup.status === 204 || cleanup.status === 200, `(${cleanup.status})`);
rawExit(text === SELECTED ? 0 : 1);
