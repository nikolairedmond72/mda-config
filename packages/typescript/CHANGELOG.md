# Changelog

All notable changes to `@snoai/mda-config` are documented here. The project follows Semantic Versioning and pins the MDA spec version it targets.

## [1.0.1] — 2026-05-07

- ci: switch to npm Trusted Publishing (GitHub OIDC); no source changes.

## [1.0.0] — 2026-05-07

- mda-spec: v1.0
- Initial release of `@snoai/mda-config` (TypeScript).
- Implements MDA §02-1.1 frontmatter extraction, §08 integrity, §09 Sigstore signature verification (wraps the official `sigstore` npm client), and §10-3.3 `requires.network` enforcement.
- Public API: `loadMdaSource`, `verifyIntegrity`, `verifySignatures`, `enforceRequires`, `MdaConfigError`, `ErrorCategory`.
- Python package skeleton (`packages/python/`) reserved for v1.1; no implementation in this release.

### Out of scope (explicit deferrals)

- `did:web` air-gap signature verification (PRD §2; loader rejects with `unknown-signer-method` when encountered).
- `requires.runtime` / `requires.tools` / `requires.packages` / `requires.model` / `requires.cost-hints` enforcement.
- Signing / production of new signatures (verify-only library).
