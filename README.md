# `mda-config`

Per-project runtime configuration loaders for files in the [MDA Open Spec](https://github.com/snoai/mda-markdown) v1.0 source-mode shape (`.mda`).

The TypeScript package is the full v1.0 implementation. The Python package is v1.0 and currently covers frontmatter extraction, MDA source-schema validation, integrity verification, and consumer pydantic validation.

- **Repo:** `github.com/sno-ai/mda-config`
- **License:** Apache-2.0
- **Spec pin:** MDA v1.0

## Packages

| Package | Status | Path |
|---------|--------|------|
| `@snoai/mda-config` (npm, TypeScript) | v1.0: integrity, Sigstore signatures, `requires.network`, Zod | [`packages/typescript/`](./packages/typescript/) |
| `snoai-mda-config` (PyPI, Python) | v1.0: frontmatter, source schema, integrity, pydantic | [`packages/python/`](./packages/python/) |

## Quick Start

TypeScript:

```bash
npm install @snoai/mda-config zod
```

```ts
import { z } from "zod";
import { loadMdaSource } from "@snoai/mda-config";

const Schema = z.object({
  name: z.string(),
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  integrity: z.record(z.string(), z.unknown()).optional(),
});

const cfg = await loadMdaSource("./preset.mda", Schema, {
  verifyIntegrity: true,
});
```

Python:

```bash
pip install snoai-mda-config pydantic
```

```python
from pydantic import BaseModel
from snoai_mda_config import load_mda_source


class Schema(BaseModel, extra="forbid"):
    name: str
    description: str
    metadata: dict | None = None
    integrity: dict | None = None


cfg = load_mda_source("./preset.mda", schema=Schema, verify_integrity=True)
```

## Documentation

- [`docs/quick-start.md`](./docs/quick-start.md) — TypeScript full v1.0 usage.
- [`packages/python/README.md`](./packages/python/README.md) — Python v1.0 usage.
- [`docs/format.md`](./docs/format.md), [`docs/trust-policy.md`](./docs/trust-policy.md), [`docs/llmix-integration.md`](./docs/llmix-integration.md).
