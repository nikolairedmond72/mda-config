# Designing a project frontmatter shape

`@snoai/mda-config` does not validate vendor-namespace contents — that is the consumer's job, expressed via a Zod schema passed to `loadMdaSource()`. This document is a short opinionated guide to picking a shape that plays well with the MDA mechanism layer (integrity, signatures, capability enforcement).

## Layout

A source-mode `.mda` for project configuration looks like this:

```yaml
---
name: gpt5-mini-fast                      # MDA §02-2.1 — kebab-case identifier
description: Fast cheap multi-tool calls. # MDA §02-2.2 — 1–1024 chars
requires:                                  # MDA §10 — top-level in source mode
  network: ["api.openai.com"]
metadata:
  mda:                                     # §02-3 — MDA-extended fields stay scoped
    doc-id: "<uuid>"
    version: "1.2.0"
    tags: [openai, fast, low-cost]
  snoai-llmix:                             # YOUR vendor namespace
    common:
      model: gpt-5-mini
      provider: openai
      temperature: 0.7
integrity:                                 # §08 — optional but recommended
  algorithm: sha256
  digest: "sha256:..."
signatures:                                # §09 — optional; requires integrity
  - signer: "sigstore-oidc:https://accounts.google.com"
    key-id: "fulcio:..."
    payload-digest: "sha256:..."
    algorithm: ecdsa-p256
    signature: "MEUCIQ..."
    rekor-log-id: "..."
    rekor-log-index: 12345678
---
# Optional Markdown body — preserved by §02-1.1 extraction.
```

## Where to put what

- **Top level**: `name`, `description`, `license`, `compatibility`, `metadata`, `integrity`, `signatures`, plus the MDA-extended fields (`requires`, `version`, `doc-id`, `tags`, `depends-on`, `author`, `created-date`, `updated-date`, `relationships`).
- **Inside `metadata.mda.*`**: optional but tidy place for MDA-extended metadata you want to keep out of the project namespace.
- **Inside `metadata.<your-vendor>.*`**: every project-specific key. The MDA loader does not parse these — your Zod schema is the source of truth.

## Vendor-namespace rules

- The namespace key MUST be a kebab-case identifier (the MDA `name` shape).
- Register your namespace in the MDA `REGISTRY.md` before stable consumer adoption (PRD §5).
- Do not put security fields (`integrity`, `signatures`) under the vendor namespace — keep them at the top level so non-MDA scanners can find them.

## Integrity discipline

- Compute the digest with `mda canonicalize` (or the same JCS recipe in `@truestamp/canonify`). Hashing the raw bytes will fail to verify.
- Re-compute the digest after every meaningful edit. A whitespace-only body change WILL invalidate the signature; that is a feature, not a bug.

## Signature trust policy

- Operators define an allow-list per OIDC issuer with an `identityPattern` regex over the cert SAN (`{issuer, identityPattern}`).
- A signature whose cert identity falls outside the allow-list is rejected with `untrusted-issuer` regardless of cryptographic validity.

## Capability declaration

- v1.0 enforces `requires.network` only. Other standard `requires` keys (`runtime`, `tools`, `packages`, `model`, `cost-hints`) pass through and are surfaced via the consumer Zod schema for advisory use.
- Use `requires.network: "none"` when the artifact must not call out at all; use a host allow-list when egress is bounded.

## Versioning

- Use SemVer 2.0.0 in `metadata.mda.version` (or top-level `version` in source mode).
- Quote the value (`"1.2.0"`) — bare `1.2.0` parses as a number in some YAML 1.1 stacks.
