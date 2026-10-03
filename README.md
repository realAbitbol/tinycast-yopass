# Yopass Share

[![CI](https://github.com/realAbitbol/tinycast-yopass/actions/workflows/ci.yml/badge.svg)](https://github.com/realAbitbol/tinycast-yopass/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey)

Share the **text you have selected** in any app as a one-click [Yopass](https://github.com/jhaals/yopass)
link. The text is encrypted locally with OpenPGP, uploaded to a Yopass instance, and
`<url>/#/s/<id>/<key>` is copied to your clipboard — one keystroke, no dialog, no typing a password.

A [Tinycast](https://github.com/abue-ammar/tinycast) extension. Yopass is a self-destructing
secret-sharing service: the decryption key travels in the link's `#fragment`, which browsers never
send to a server, so the instance stores ciphertext it cannot read.

```
select text → hotkey → clipboard: https://share.yopass.se/#/s/<id>/<22-char key>
```

## Requirements

| | |
| --- | --- |
| macOS | Tinycast is macOS-only |
| [Tinycast](https://github.com/abue-ammar/tinycast) | any recent release |
| [Node.js](https://nodejs.org) | **required by Tinycast's installer**, not by this extension — see below |
| A Yopass instance | optional: the defaults point at the public `https://share.yopass.se` |

Node is needed because Tinycast builds source installs on your Mac, whatever the extension is. This
repository has **zero dependencies and no bundler**, so no package is downloaded and no toolchain is
required beyond `node` (and a package manager, which the installer also insists on).

## Install (from GitHub)

Tinycast installs extensions straight from their source on GitHub:

1. Open **Tinycast → Settings → Extensions → Install New → Install from GitHub**.
2. Paste the repository:

   ```
   realAbitbol/tinycast-yopass
   ```

   A clone URL, or the `/tree/<ref>/<path>` link your browser copies from a folder, work too.
3. Install. Tinycast downloads the repository, runs `npm install --ignore-scripts` and then this
   project's `npm run build` (which needs no dependencies), and copies exactly three things into
   `~/Library/Application Support/com.tinycast.app/extensions/yopass-share/`:

   ```
   package.json            the manifest
   share-selected-text.js  the built command
   assets/icon.png         the icon
   ```

4. Give the command a global hotkey: **Settings → Extensions → Share Selected Text**. A `no-view`
   command is meant to be run from a shortcut, not from the palette.

Then select text in any app, press the hotkey, and paste.

### Other ways in

* **Add from folder** — `git clone` the repository and point *Install New → Add from folder* at it.
  The repository root *is* the install layout, so nothing has to be built first.
* **Manual copy** — copy `package.json`, `share-selected-text.js` and `assets/` into the extension
  directory above.

> Tinycast scans its extensions directory at launch. After a manual copy, **restart Tinycast** (or
> toggle extensions in Settings) — a running instance will not notice the new folder.

## Settings

| Setting | Type | Default | Notes |
| --- | --- | --- | --- |
| **Yopass URL** | textfield | `https://share.yopass.se` | the web UI, used to build the link (no trailing slash) |
| **Yopass API URL** | textfield | `https://api.yopass.se` | the API. Same origin as above on a single-origin instance |
| **Expiration** | dropdown | One Day | One Hour / One Day / One Week |
| **One-Time Download** | checkbox | on | the secret is deleted after the first view |

There is deliberately no "password" setting: the key is always generated, 22 characters of
`[A-Za-z0-9]` — the same shape the Yopass web UI generates for itself.

The defaults point at the public Yopass instance so the extension works out of the box. **Point both
fields at your own instance** if you'd rather not hand your ciphertext to someone else's server —
self-hosting is a `docker run` away ([jhaals/yopass](https://github.com/jhaals/yopass)).

## How it works

1. `getSelectedText()`, or a deeplink's `fallbackText`.
2. Encrypt locally: OpenPGP symmetric encryption with a fresh random key
   (`openpgp.encrypt({ message, passwords: [key] })`, 5.11.3 defaults → SEIPDv1 + MDC, RFC 4880).
3. `POST <apiUrl>/create/secret` with `{ expiration, message, one_time }` → `{ message: "<id>" }`.
4. `Clipboard.copy("<url>/#/s/<id>/<key>")` and a HUD.

The server never sees the key: it is generated after the ciphertext is produced, and it only ever
appears in the URL fragment of the link on your clipboard.

## Security

**What leaves your machine:** the OpenPGP-armored ciphertext, the expiry, and the one-time flag.
Nothing else. Your instance cannot decrypt it, and neither can anyone watching the network.

**What the recipient needs:** the whole link, and nothing else. The key is in the fragment, which is
also why a link is as sensitive as the secret — anyone who has it can read the message until it
expires or is viewed.

**Deliberate limits, so you can decide:**

* The plaintext is in your clipboard, in the selected app, and in this extension's memory. That is
  unavoidable for a "share what I selected" tool; it is not a hardened editor.
* Link preview machinery (Slack, Teams, mail clients) will not see the secret — a fragment is not
  sent in the HTTP request — but the *existence* of a link, its host, its size and its timing are
  metadata your instance can see.
* `require_auth` and `receipt` are not sent. Instances that force them are not supported yet.
* The extension sends the message with the default crypto configuration. That is interoperable and
  conservative; it is not audited by anyone, including me.
* Self-hosting is the only way to control who sees the ciphertext. The default is somebody else's
  server, and that is a documented choice, not an oversight.

Found a security problem? See [SECURITY.md](SECURITY.md) — please report it privately.

## Compatibility

Measured on 2026-10-03 against the Yopass 13.x API:

* **Yopass ≥ 13.0.0 is required.** The old `POST /secret` route was replaced by
  `POST /create/secret`, which is what this extension uses. A pre-13 instance answers 404.
* **Single-origin vs split origins.** On the public deployment the app is `share.yopass.se`, the API
  is `api.yopass.se` and `yopass.se` is only the documentation site. Put the *web UI* origin in
  **Yopass URL** (links must open the app, not the docs) and the *API* origin in **Yopass API URL**.
  On a self-hosted single-origin instance both fields are the same URL.
* `GET /config` decides the cipher. `ARGON2:false` (the default) accepts the OpenPGP.js 5.x output
  this extension produces. An instance with `ARGON2:true` requires `s2kType: argon2` *and* AEAD,
  which needs OpenPGP.js ≥ 6 — this extension would have to be rebuilt against v6.
* `PREFETCH_SECRET`, `READ_RECEIPTS`, `FORCE_ONETIME_SECRETS` and `REQUIRE_AUTH` change what the web
  UI does; only `REQUIRE_AUTH` would need a change here (a `require_auth` field in the POST).

## Development

No dependencies, no bundler, no build step you have to install:

```
package.json                     the Raycast manifest Tinycast reads (commands + preferences)
share-selected-text.js           the BUILT command — committed, because the root is what gets installed
src/share-selected-text.js       the command source (plain JS; only @raycast/api is required)
vendor/openpgp-5.11.3.min.js     OpenPGP.js BROWSER build, sha256-pinned (see vendor/README.md)
assets/icon.png                  the icon (see assets/README.md for its provenance)
build.mjs                        concatenates vendor + src → ./share-selected-text.js
test/                            offline suite + the real-runtime harness
```

```sh
npm run build     # writes share-selected-text.js at the repo root
npm test          # offline suite: no network, no app, no dependencies
npm run verify    # fails if the committed bundle is out of date (what CI runs)
```

**Zero dependencies is a rule, not an accident.** Tinycast decides how to build a GitHub install by
looking for `node_modules/.bin/ray`: if a dependency shipped the `ray` toolchain, the installer would
take the `ray build` path instead of this project's script, and `ray` is not how this bundle is made.
So `package.json` carries no `dependencies` and no `devDependencies`, and neither should yours.

The bundle is 544 KB, of which OpenPGP.js is 540 KB. "Bundling" is a concatenation, which is possible
only because the browser build is a self-contained UMD with zero `require()` calls — `build.mjs`
*proves* both properties on every run, along with the vendor's sha256, before emitting anything.

**Never hand-edit `share-selected-text.js`.** Edit `src/`, run `npm run build`, commit both. CI fails
on a stale bundle.

### Tests

`npm test` is fully offline and runs the same files CI does:

* `test/bundle-offline.mjs` — loads the **built bundle** in a Tinycast-like global (a `crypto` shim
  with `getRandomValues` and **no `subtle`**, a stubbed `@raycast/api`, a stubbed `fetch`) and checks
  the contract: the link shape, the key's alphabet and length, the one-time/expiration flags, the
  HUD on both the success and "nothing selected" paths — then decrypts the posted ciphertext with the
  vendored OpenPGP.js to prove the recipient can read it.
* `test/install-contract.mjs` — checks that the repository root satisfies Tinycast's installer: a
  manifest whose every command has a `<name>.js` beside it, a 512×512 PNG icon, sane preference
  defaults, and an up-to-date bundle.
* `test/run-tests.mjs` — runs both.

The harness below is **not** part of `npm test`: it needs the Tinycast app and a live instance.

### The real-runtime harness

`test/run-in-tinycast-runtime.mjs` evaluates the built bundle inside the **actual runtime shipped in
the app** (`/Applications/Tinycast.app/Contents/Resources/RaycastRuntime.generated.js`) behind a host
stub, then fetches the secret back and decrypts it with the recipient's own OpenPGP code. It
reproduces exactly the environment that breaks the store extension: the real `@raycast/api` shim, the
real `crypto` shim (no `getCiphers`, no `subtle`), the real module loader, the runtime's own
host-bridged `fetch`.

```sh
# Point it at an instance you are allowed to write to (a local one, or your own):
export YOPASS_URL=http://127.0.0.1:1337 YOPASS_API_URL=http://127.0.0.1:1337
# crypto-<hash>.js = the instance frontend's own chunk, the recipient-side oracle:
curl -s "$YOPASS_URL/" | grep -o '/assets/crypto-[^"]*'
YOPASS_UI_CHUNK=/path/to/crypto-<hash>.js node test/run-in-tinycast-runtime.mjs

EXT_TEST_NO_SELECTION=1 node test/run-in-tinycast-runtime.mjs                 # → "Select some text first"
EXT_TEST_PREFS='{"preferences":{"duration":"604800","oneTime":false}}' \
  node test/run-in-tinycast-runtime.mjs                                       # one week, not one-time
```

Measured output against the public instance (`YOPASS_URL=https://share.yopass.se`,
`YOPASS_API_URL=https://api.yopass.se`), using that deployment's own frontend chunk as the oracle:

```
runtime: RaycastRuntime.generated.js
command: yopass-share/share-selected-text (mode no-view)
HUDs: ["🔗 Link copied (one-time)"]
host fetches: POST https://api.yopass.se/create/secret
clipboard: https://share.yopass.se/#/s/<id>/<22-char key>
frontend oracle: i() then o()
recipient decrypt matches selected text: true
secret deleted from the instance: true (204)          exit 0
```

Note the split origin: the POST goes to `api.yopass.se` while the link points at `share.yopass.se`,
and the secret is read back and deleted through the API origin — the link's origin is the web UI and
does not serve the API.

Harness notes: the chunk's exports are minified and differ per build (this deployment exposes the
parse/decrypt pair as `i()`/`o()`, an older one as `s()`/`c()`), so the harness finds the pair by
*using* it rather than by name; `YOPASS_UI_PARSE` and `YOPASS_UI_DECRYPT` pin them if you prefer.
The runtime replaces `console`, `process.stdout`, `process.env`, `setTimeout` and `globalThis.fetch`,
so the harness captures the real ones *before* evaluating it and services timers, fetch and crypto
through the host stub. Its HTTP goes through `node:https`, not undici — undici needs
`setTimeout(...).unref()`, and the runtime's timer shim hands back a numeric id; in the app that call
is native Swift anyway. It deletes the secret it created, and says so.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `TypeError: t.getCiphers is not a function` | You are running the **store** `yopass` extension, which bundles OpenPGP.js's Node build; its `getNodeCrypto().getCiphers()` probe dies at import on Tinycast's `crypto` shim. Install this one instead — see below. |
| HUD: `❌ Select some text first` | Nothing was selected, and the launch carried no `fallbackText`. |
| HUD: `❌ 404 page not found` (or a similar Go error) | The instance is older than Yopass 13.0.0 and has no `/create/secret`. |
| HUD: `❌ Set the Yopass URL and API URL…` | A preference was cleared; `url` and `apiUrl` are required. |
| The link opens a documentation page | **Yopass URL** points at the project site instead of the app: `yopass.se` is docs, `share.yopass.se` is the app. |
| `no built command bundles` in Tinycast | The installer's build ran but produced nothing — check that `node` is on the PATH Tinycast can see (Settings → Extensions → Install New → custom search paths), then reinstall. |

### Why the store extension crashes

The Raycast Store `yopass` extension bundles `openpgp/dist/node/openpgp.min.js`. The Node build's
`getNodeCrypto()` returns `require('crypto')` unconditionally, and OpenPGP.js probes the runtime's
cipher list at module scope via `getNodeCrypto().getCiphers()`. Tinycast runs extensions on
JavaScriptCore behind a hand-written `crypto` shim that has hashes, HMAC, PBKDF2, AES-CBC/ECB, random
and UUID — and no `getCiphers`, so the import itself throws.

Two independent defects, then:

1. The crash above, fixed here by vendoring the **browser** build, whose `getNodeCrypto` is
   `function(){}` (it returns `undefined`, so every Node-crypto branch is skipped) and which contains
   no `require()` at all.
2. A hardcoded `POST ${apiUrl}/secret` in that extension, which Yopass 13.0.0 removed — so even with
   the crash fixed, it 404s against a current instance.

Upstream report: [raycast/extensions#30813](https://github.com/raycast/extensions/issues/30813).

## Credits & licence

* [OpenPGP.js](https://github.com/openpgpjs/openpgpjs) 5.11.3, browser build, vendored unmodified in
  `vendor/` — **LGPL-3.0-or-later** (licence text in `vendor/LICENSE.LGPL-3.0.txt`). Its code is
  inside the built bundle; the full source is at the link above.
* [Yopass](https://github.com/jhaals/yopass) by Johan Haals, Apache-2.0 — the service this talks to.
* `assets/icon.png` is the Yopass logo, taken from the Yopass Raycast extension in the MIT-licensed
  [raycast/extensions](https://github.com/raycast/extensions) repository.
* This project is **not affiliated** with Yopass, Raycast or Tinycast.

This project's own code is **MIT** — see [LICENSE](LICENSE). Third-party material (the vendored
OpenPGP.js, the icon) is listed in [NOTICE](NOTICE).

Contributions are welcome; [CONTRIBUTING.md](CONTRIBUTING.md) is short and mostly about not adding
dependencies.
