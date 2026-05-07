# Quick Start

Use `@snoai/mda-config` when your app owns a `.mda` config shape and wants the
MDA mechanism layer handled in one call: frontmatter extraction, optional
integrity verification, optional Sigstore verification, `requires.network`
enforcement, then your Zod schema.

## Install

```bash
npm install @snoai/mda-config zod
```

`zod` is a peer dependency because the package validates your project-specific
frontmatter with the schema you provide.

## Write a Minimal `.mda` File

```markdown
---
name: gpt5-mini-fast
description: Fast cheap calls for everyday agent work.
requires:
  network: ["api.openai.com"]
metadata:
  snoai-llmix:
    common:
      provider: openai
      model: gpt-5-mini
      temperature: 0.7
      maxOutputTokens: 4096
    providerOptions:
      openai:
        reasoningEffort: medium
    caching:
      strategy: memory
---

# gpt5-mini-fast

Use when latency and cost matter more than deep reasoning.
```

## Load It

```ts
import { z } from "zod";
import {
  ErrorCategory,
  MdaConfigError,
  loadMdaSource,
} from "@snoai/mda-config";

const LLMixPresetSchema = z.object({
  name: z.string(),
  description: z.string(),
  requires: z
    .object({
      network: z.union([
        z.literal("none"),
        z.literal("local"),
        z.literal("public"),
        z.array(z.string()),
      ]),
    })
    .optional(),
  metadata: z.object({
    "snoai-llmix": z.object({
      common: z.object({
        provider: z.enum([
          "openai",
          "anthropic",
          "google",
          "deepseek",
          "openrouter",
          "sno-gpu",
        ]),
        model: z.string().min(1),
        temperature: z.number().min(0).max(2).optional(),
        maxOutputTokens: z.number().int().positive().optional(),
      }),
      providerOptions: z.record(z.string(), z.unknown()).optional(),
      caching: z
        .object({
          strategy: z.enum([
            "native",
            "gateway",
            "disabled",
            "redis",
            "redis-or-memory",
            "memory",
          ]),
        })
        .optional(),
    }),
  }),
});

try {
  const preset = await loadMdaSource("./presets/gpt5-mini-fast.mda", LLMixPresetSchema, {
    enforceRequires: true,
    allowedNetworks: ["api.openai.com"],
  });

  const model = preset.metadata["snoai-llmix"].common.model;
} catch (err) {
  if (err instanceof MdaConfigError) {
    if (err.category === ErrorCategory.RequiresNotSatisfied) {
      // The file asked for network access your runtime did not allow.
    }
    throw err;
  }
  throw err;
}
```

That is the normal integration path: your schema owns
`metadata.<your-vendor>.*`; `@snoai/mda-config` owns the MDA checks around it.

## Turn On Verification

Integrity is opt-in:

```ts
await loadMdaSource(path, schema, {
  verifyIntegrity: true,
});
```

Signatures require integrity plus an operator trust policy and Rekor lookup:

```ts
await loadMdaSource(path, schema, {
  verifyIntegrity: true,
  verifySignatures: true,
  trustPolicy: {
    allowedSigners: [
      {
        issuer: "https://accounts.google.com",
        identityPattern: /^releases@snoai\.com$/,
      },
    ],
  },
  rekorClient,
});
```

See [`trust-policy.md`](./trust-policy.md) for the Rekor client shape and
Sigstore boundary.

## What Gets Returned

`loadMdaSource()` returns the parsed frontmatter after your Zod schema succeeds.
The Markdown body is used for integrity canonicalization but is not returned by
the loader. If your app needs body content, keep that as a separate reader path.

Common failure categories are stable strings on `MdaConfigError.category`:

- `schema-violation`: invalid MDA source-mode frontmatter.
- `project-schema-violation`: your Zod schema rejected the frontmatter.
- `integrity-mismatch`: `verifyIntegrity` found a digest mismatch.
- `requires-not-satisfied`: `requires.network` exceeds `allowedNetworks`.
- `signature-verification-failure` / `untrusted-issuer`: Sigstore verification
  or trust policy failed.
