# Contributing

Bug reports and pull requests are welcome. Two rules carry most of the weight.

## 1. Do not add dependencies

`package.json` has no `dependencies` and no `devDependencies`, and that is load-bearing: Tinycast
decides how to build a GitHub install by looking for `node_modules/.bin/ray`. A dependency that
brought the Raycast toolchain would send the installer down `ray build` instead of this project's
script, and `ray` is not how this bundle is produced. OpenPGP.js is vendored as a file for the same
reason — a self-contained browser UMD with no `require()` calls, which can be concatenated.

## 2. Never hand-edit the built bundle

`share-selected-text.js` at the repository root is generated. Edit `src/`, then:

```sh
npm run build     # regenerate the bundle
npm test          # offline: bundle contract, behaviour, decryption round-trip, install contract
```

Commit `src/`, `build.mjs` and the regenerated bundle together. CI runs `npm test`, which fails on a
stale bundle.

## Changing the vendored OpenPGP.js

The version is pinned by sha256 in `build.mjs`, which also asserts two properties of the file: it is
the browser build (`getNodeCrypto:function(){}`) and it contains no `require(`. If you bump it, update
the constant, the filename, `vendor/README.md` and this note. Do **not** use
`dist/node/openpgp.min.js` — on Tinycast its `getCiphers()` probe throws at import, which is the
entire reason this extension exists.

## Development environment

Any Node.js that runs `node:test`-less plain scripts (this project uses no test framework, just
scripts that exit non-zero). There is nothing to install. macOS is needed only for the optional
real-runtime harness, which reads the Tinycast app's own runtime file:

```sh
node test/run-in-tinycast-runtime.mjs      # opt-in; needs Tinycast installed and an instance to write to
```

Point that harness only at an instance you are allowed to write to — it creates a secret and deletes
it again. Never commit the output of a run against a private instance.

## Style

Match the surrounding code: plain CommonJS in `src/`, ESM in `build.mjs` and `test/`, two-space
indent, no dependency for anything the standard library already does. Keep the diff small — a
correct, minimal change to a working bundle beats a rewrite.
