# `@snoai/mda-config` (TypeScript)

Source-mode `.mda` loader implementing the MDA Open Spec v1.0 mechanism layer:

- §02-1.1 frontmatter extraction (BOM strip, CRLF normalization, fence rules, YAML 1.2 core schema)
- §08 integrity (JCS canonicalization + sha256/384/512)
- §09 Sigstore signature verification (DSSE PAE; wraps the official `sigstore` npm client; enforces `dsse-v0.0.1` Rekor entry kind)
- §10-3.3 `requires.network` enforcement
- §11-2 canonical loader algorithm (Stages A → G); §11-3 error vocabulary surfaced as `ErrorCategory`

## Install

```bash
npm install @snoai/mda-config zod
# or: pnpm add / bun add
```

## Usage

```ts
import { z } from "zod";
import { loadMdaSource, MdaConfigError, ErrorCategory } from "@snoai/mda-config";

const MyConfigSchema = z.object({
  name: z.string(),
  description: z.string(),
  requires: z.object({ network: z.array(z.string()).optional() }).optional(),
  metadata: z.object({
    "snoai-llmix": z.object({
      common: z.object({ model: z.string(), provider: z.string() }),
    }),
  }),
});

const cfg = await loadMdaSource("./presets/gpt5-mini-fast.mda", MyConfigSchema, {
  verifyIntegrity: true,
  enforceRequires: true,
  allowedNetworks: ["api.openai.com"],
});

// For signed release presets, also pass verifySignatures: true with a Rekor client and trust policy.
```

See [`../../docs/format.md`](../../docs/format.md), [`../../docs/trust-policy.md`](../../docs/trust-policy.md), and [`../../docs/llmix-integration.md`](../../docs/llmix-integration.md).

## Compatibility

v1.0 supports `sigstore-oidc:` only; `did-web:` signers are rejected with `unknown-signer-method` and will be supported in v1.1.

## API

| Symbol | Spec section |
|--------|--------------|
| `loadMdaSource(path, zodSchema, options)` | §11-2 |
| `verifyIntegrity(frontmatter, body, integrity)` | §08-4 |
| `verifySignatures(signatures, integrity, policy, deps)` | §09-4.2 |
| `enforceRequires(requires, env)` | §10-4 |
| `extractFrontmatter(bytes)` / `parseFrontmatterYaml(str)` | §02-1.1 |
| `MdaConfigError` + `ErrorCategory` | §11-3 |

## Spec pin

- `mda-spec: v1.0`
- License: Apache-2.0

## Out of scope at v1.0 (PRD §2)

- Signing path (verify-only library).
- `did:web` air-gap signatures (rejected with `unknown-signer-method`).
- `requires.runtime` / `requires.tools` / `requires.packages` / `requires.model` / `requires.cost-hints` enforcement (passed through to the consumer's Zod schema).
- Python port (`snoai-mda-config` ships in v1.1).
