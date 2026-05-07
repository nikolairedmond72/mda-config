# `@snoai/mda-config`

Per-project runtime configuration loader for files in the [MDA Open Spec](https://github.com/snoai/mda-markdown) v1.0 source-mode shape (`.mda`). Verifies integrity, Sigstore signatures, and enforces `requires.network` capability declarations on top of a consumer-supplied Zod schema.

- **Repo:** `github.com/sno-ai/mda-config`
- **License:** Apache-2.0
- **Spec pin:** MDA v1.0

## Packages

| Package | Status | Path |
|---------|--------|------|
| `@snoai/mda-config` (npm, TypeScript) | v1.0 | [`packages/typescript/`](./packages/typescript/) |
| `snoai-mda-config` (PyPI, Python) | deferred to v1.1 | [`packages/python/`](./packages/python/) |

See [`packages/typescript/README.md`](./packages/typescript/README.md) for the TypeScript API and usage examples.

Documentation: [`docs/format.md`](./docs/format.md), [`docs/trust-policy.md`](./docs/trust-policy.md), [`docs/llmix-integration.md`](./docs/llmix-integration.md).
