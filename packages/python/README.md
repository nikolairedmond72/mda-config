# snoai-mda-config

Python source-mode loader for MDA v1.0 configuration artifacts.

This package mirrors the TypeScript `@snoai/mda-config` loader. The v1.0
surface covers frontmatter extraction, MDA source-schema validation, integrity
verification, and consumer pydantic validation.

```python
from pathlib import Path
from pydantic import BaseModel
from snoai_mda_config import load_mda_source


class Preset(BaseModel, extra="forbid"):
    name: str
    description: str
    metadata: dict | None = None
    integrity: dict | None = None
    signatures: list[dict] | None = None


config = load_mda_source(
    Path("preset.mda"),
    schema=Preset,
    verify_integrity=True,
)
```
