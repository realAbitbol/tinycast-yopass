# vendor/openpgp-5.11.3.min.js

Upstream artifact, unmodified except for the trailing `//# sourceMappingURL` comment, which
`build.mjs` strips.

- Package: `openpgp@5.11.3`
- File: `dist/openpgp.min.js` — the **browser** build, not `dist/node/openpgp.min.js`
- sha256: `89ae4b15e830e08096a125003218bdc7b5c39a4075437dc8d6d4a4e3bdc9a550`
- License: LGPL-3.0-or-later (OpenPGP.js) — see `LICENSE.LGPL-3.0.txt`; source at
  <https://github.com/openpgpjs/openpgpjs>. Our own code is MIT.

`build.mjs` pins the sha256 and refuses to build if the file changes, and it asserts the two
properties the build depends on: `getNodeCrypto:function(){}` is present, and the file contains no
`require(` call at all. That second property is what makes a 540 KB dependency inlinable into a
single command file with no bundler.

## Why the browser build, and not the Node one

Tinycast runs extensions on JavaScriptCore with a hand-written Node surface. Its `crypto` shim
implements hashes, HMAC, PBKDF2, AES-CBC/ECB, random and UUID — **no `getCiphers`**, and
`globalThis.crypto.subtle` is `undefined`.

The Node build's `getNodeCrypto()` returns `require('crypto')` unconditionally, and OpenPGP.js calls
`getNodeCrypto().getCiphers()` at module scope to probe which ciphers the runtime has. On Tinycast
that is:

    TypeError: t0.getCiphers is not a function

The browser build defines `getNodeCrypto: function(){}` — it returns `undefined`, so every
`C.getNodeCrypto() && …` branch is skipped and the pure-JS implementations (AES, SHA, S2K, random via
`crypto.getRandomValues`) are used instead.

## Refresh procedure (only if the version is ever bumped)

```sh
curl -O https://registry.npmjs.org/openpgp/-/openpgp-<version>.tgz
tar xzf openpgp-<version>.tgz package/dist/openpgp.min.js
shasum -a 256 package/dist/openpgp.min.js   # move it into build.mjs, VENDOR_SHA256
```

Then rename the file, update `build.mjs` and the paths above, rebuild, and run `npm test` — the
offline suite re-checks the guards and the encryption round-trip. Note that a v6 bump also changes
the API (`readMessage` parses, `decrypt` takes the parsed message) and enables AEAD, which is a
behaviour change, not just a version number. See the README's Compatibility section.
