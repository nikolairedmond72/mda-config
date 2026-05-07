# LLMix integration

LLMix (`@snoai/llmix`) is the first downstream consumer of `@snoai/mda-config`. This document walks through the migration from LLMix's plain-YAML preset loader to MDA-anchored presets.

## Before

`tests/fixtures/sample_preset.yaml`:

```yaml
common:
  model: gpt-5-mini
  provider: openai
  temperature: 0.7
  maxOutputTokens: 4096
providerOptions:
  openai:
    reasoningEffort: medium
caching:
  strategy: memory
```

LLMix loads this with `js-yaml` + a Zod schema (`apps/llmix-cli/src/yaml-loader.ts`).

## After

Rename to `sample_preset.mda` and wrap the LLMix-specific keys under the `metadata.snoai-llmix.*` namespace:

```markdown
---
name: gpt5-mini-fast
description: Fast cheap multi-tool calls for everyday agent work.
requires:
  network: ["api.openai.com"]
metadata:
  mda:
    doc-id: 38f5a922-81b2-4f1a-8d8c-3a5be4ea7511
    version: "1.2.0"
    tags: [openai, fast, low-cost]
  snoai-llmix:
    common:
      model: gpt-5-mini
      provider: openai
      temperature: 0.7
      maxOutputTokens: 4096
    providerOptions:
      openai:
        reasoningEffort: medium
    caching:
      strategy: memory
integrity:
  algorithm: sha256
  digest: "sha256:..."
signatures:
  - signer: "sigstore-oidc:https://accounts.google.com"
    key-id: "fulcio:..."
    payload-digest: "sha256:..."
    algorithm: ecdsa-p256
    signature: "MEUCIQ..."
    rekor-log-id: "..."
    rekor-log-index: 12345678
---

# gpt5-mini-fast

Use when:
- Multi-tool dispatch where each call should be cheap
- Latency-sensitive interactive UX
```

## Loader migration

Replace `yaml-loader.ts`'s parse path with one call:

```ts
import { z } from "zod";
import { loadMdaSource } from "@snoai/mda-config";

const LLMixPresetSchema = z.object({
  name: z.string(),
  description: z.string(),
  requires: z.object({ network: z.array(z.string()).optional() }).optional(),
  metadata: z.object({
    mda: z
      .object({
        version: z.string().optional(),
        "doc-id": z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
    "snoai-llmix": z.object({
      common: z.object({ /* … existing LLMix shape … */ }),
      providerOptions: z.record(z.string(), z.unknown()).optional(),
      caching: z.object({ strategy: z.string() }).optional(),
    }),
  }),
});

const cfg = await loadMdaSource(presetPath, LLMixPresetSchema, {
  verifyIntegrity: true,
  verifySignatures: true,
  enforceRequires: true,
  allowedNetworks: ["api.openai.com", "api.anthropic.com"],
  trustPolicy: {
    allowedSigners: [
      { issuer: "https://accounts.google.com", identityPattern: /^releases@snoai\.com$/ },
    ],
  },
  rekorClient: yourRekorClient,
});
```

LLMix keeps its existing Zod schema — `@snoai/mda-config` only adds the MDA mechanism layer (extraction, integrity, signatures, requires) on top.

## Migration checklist

1. Rename `*.yaml` → `*.mda`.
2. Move `common` / `providerOptions` / `caching` under `metadata.snoai-llmix.*`.
3. Add top-level `name` + `description`.
4. Optionally add `requires.network`, `integrity`, `signatures`.
5. Replace the YAML loader call with `loadMdaSource()`.
6. Wire a Rekor client and trust policy when promoting to production.

LOC delta: ~150 lines of bespoke YAML/Zod loading code go away in the LLMix repo; `@snoai/mda-config` carries them.

## Python migration

Deferred to v1.1 with `snoai-mda-config` on PyPI. Until then, Python LLMix consumers continue to use the plain-YAML loader; once `snoai-mda-config` ships it will mirror the TypeScript surface.
