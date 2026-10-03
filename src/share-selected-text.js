"use strict";
/**
 * Yopass Share — share the selected text as a one-click Yopass link.
 *
 * Command mode: no-view. Reads the selected text, encrypts it locally with OpenPGP
 * (password = a fresh 22-char key, always generated), POSTs the armored message to
 * <apiUrl>/create/secret and copies <url>/#/s/<id>/<key> to the clipboard.
 *
 * Only `@raycast/api` is required; everything else is inlined by build.mjs.
 * The `openpgp` global is the OpenPGP.js BROWSER build (see vendor/README.md): the Node build asks
 * node's crypto for the runtime's cipher list at import time, Tinycast's crypto shim has no such
 * entry point, and the module throws before the command ever runs.
 */

const api = require("@raycast/api");

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_LENGTH = 22; // same shape as the Yopass web UI's own generated key
const DEFAULT_EXPIRATION = 86400; // one day

/** Preference values arrive as string | boolean | number depending on the control. */
function truthy(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value !== "false" && value !== "0";
  return Boolean(value);
}

function trimTrailingSlashes(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function generateKey(length) {
  const webcrypto = globalThis.crypto;
  if (!webcrypto || typeof webcrypto.getRandomValues !== "function") {
    throw new Error("No secure random source available");
  }
  const bytes = new Uint8Array(length);
  webcrypto.getRandomValues(bytes);
  let key = "";
  for (const byte of bytes) key += ALNUM[byte % ALNUM.length];
  return key;
}

async function resolveText(props) {
  const fallback = props && typeof props.fallbackText === "string" ? props.fallbackText : "";
  if (fallback.trim()) return fallback;
  const selected = await api.getSelectedText();
  return typeof selected === "string" ? selected : "";
}

async function share(text, preferences) {
  const key = generateKey(KEY_LENGTH);
  const message = await openpgp.encrypt({
    message: await openpgp.createMessage({ text }),
    passwords: [key],
  });

  const response = await fetch(`${preferences.apiUrl}/create/secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expiration: preferences.expiration,
      message,
      one_time: preferences.oneTime,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (response.status !== 200 || !body || typeof body.message !== "string" || !body.message) {
    const detail = (body && (body.message || body.error)) || `HTTP ${response.status}`;
    throw new Error(String(detail));
  }

  const link = `${preferences.url}/#/s/${body.message}/${key}`;
  await api.Clipboard.copy(link);
  return link;
}

async function main(props) {
  try {
    const raw = api.getPreferenceValues();
    const preferences = {
      url: trimTrailingSlashes(raw.url),
      apiUrl: trimTrailingSlashes(raw.apiUrl) || trimTrailingSlashes(raw.url),
      expiration: (() => {
        const parsed = parseInt(String(raw.duration ?? ""), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXPIRATION;
      })(),
      oneTime: truthy(raw.oneTime, true),
    };

    if (!preferences.url || !preferences.apiUrl) {
      await api.showHUD("❌ Set the Yopass URL and API URL in the extension settings");
      return;
    }

    const text = await resolveText(props);
    if (!text.trim()) {
      await api.showHUD("❌ Select some text first");
      return;
    }

    const link = await share(text, preferences);
    await api.showHUD(`🔗 Link copied${preferences.oneTime ? " (one-time)" : ""}`, { clearRootSearch: true });
    return link;
  } catch (error) {
    await api.showHUD(`❌ ${error && error.message ? error.message : String(error)}`);
    return undefined;
  }
}

module.exports = main;
// Tinycast resolves a command as `mod.default ?? mod`; both spellings are safe.
module.exports.default = main;
