# Security policy

## Reporting a vulnerability

Please use GitHub's private reporting: **Security → Report a vulnerability** on this repository
(https://github.com/realAbitbol/tinycast-yopass/security/advisories/new). That opens a draft advisory
only you and the maintainer can see.

Do not open a public issue for anything that could let someone read a secret they should not, and do
not paste a real secret, key or link into a report. A synthetic example is enough.

Expect an acknowledgement within a few days. This is a small, single-maintainer project with no
funding and no embargo process beyond "we fix it, then we tell people".

## Scope

In scope:

* The encryption performed by this extension, or anything that would let the instance — or a passive
  network observer — read a shared secret.
* Key generation: predictability, length, entropy source, or reuse.
* The link format, if it could leak the key to a server (fragments are not sent in HTTP requests; a
  change that put the key before the `#` would be a serious bug).
* Anything that makes the extension send content to a host the user did not configure.

Out of scope:

* Vulnerabilities in [Yopass](https://github.com/jhaals/yopass) itself or in the instance you point
  this at — report those upstream.
* Vulnerabilities in [OpenPGP.js](https://github.com/openpgpjs/openpgpjs) — report those upstream.
  The vendored copy is 5.11.3 and its sha256 is pinned in `build.mjs`; a bump is a normal PR.
* The fact that the extension can read your selection, or that the clipboard holds the plaintext and
  the link. That is what it is for — see the limits in the README's Security section.
* Someone with the link being able to read the secret. That is Yopass's design.

## What this extension does not claim

It performs encryption with the OpenPGP.js defaults and talks to an instance you configure. It is not
audited, it does not implement its own cryptography, and it cannot protect a secret from the person
you send it to.
