from __future__ import annotations

from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict

from snoai_mda_config import (
    ErrorCategory,
    MdaConfigError,
    load_mda_source,
    load_mda_source_from_bytes,
)

from .conftest import FIXTURES


class MinimalSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str
    metadata: dict[str, Any] | None = None
    requires: dict[str, Any] | None = None
    integrity: dict[str, Any] | None = None
    signatures: list[dict[str, Any]] | None = None


def test_loads_minimal_source_mode_file() -> None:
    cfg = load_mda_source(FIXTURES / "valid/01-minimal.mda", schema=MinimalSchema)

    assert cfg.name == "minimal-config"


def test_rejects_yaml_parse_errors() -> None:
    with pytest.raises(MdaConfigError) as exc_info:
        load_mda_source(FIXTURES / "invalid/10-yaml-parse-error.mda", schema=MinimalSchema)

    assert exc_info.value.category is ErrorCategory.FrontmatterYamlParseError


def test_rejects_integrity_mismatch_when_enabled() -> None:
    with pytest.raises(MdaConfigError) as exc_info:
        load_mda_source(
            FIXTURES / "invalid/11-integrity-mismatch.mda",
            schema=MinimalSchema,
            verify_integrity=True,
        )

    assert exc_info.value.category is ErrorCategory.IntegrityMismatch


def test_verifies_integrity_when_enabled() -> None:
    cfg = load_mda_source(
        FIXTURES / "valid/02-with-integrity.mda",
        schema=MinimalSchema,
        verify_integrity=True,
    )

    assert cfg.integrity is not None
    assert cfg.integrity["algorithm"] == "sha256"


def test_loads_llmix_sample_preset_with_integrity() -> None:
    cfg = load_mda_source(
        FIXTURES / "valid/sample_preset.mda",
        schema=MinimalSchema,
        verify_integrity=True,
    )

    assert cfg.metadata is not None
    llmix = cfg.metadata["snoai-llmix"]
    assert llmix["common"]["model"] == "gpt-5-mini"
    assert llmix["common"]["maxOutputTokens"] == 4096


def test_rejects_signature_digest_mismatch_in_stage_c() -> None:
    with pytest.raises(MdaConfigError) as exc_info:
        load_mda_source(FIXTURES / "invalid/12-signature-digest-mismatch.mda", schema=MinimalSchema)

    assert exc_info.value.category is ErrorCategory.SignatureDigestMismatch


def test_project_schema_violations_use_project_category() -> None:
    class NarrowSchema(BaseModel):
        model_config = ConfigDict(extra="forbid")

        name: str

    with pytest.raises(MdaConfigError) as exc_info:
        load_mda_source(FIXTURES / "valid/01-minimal.mda", schema=NarrowSchema)

    assert exc_info.value.category is ErrorCategory.ProjectSchemaViolation


def test_missing_frontmatter_is_rejected_for_source_mode() -> None:
    with pytest.raises(MdaConfigError) as exc_info:
        load_mda_source_from_bytes(b"# body only\n", schema=MinimalSchema)

    assert exc_info.value.category is ErrorCategory.MissingRequiredFrontmatter


def test_mda_schema_violation_surfaces_schema_category() -> None:
    source = b"""---
name: Not-Kebab
description: Invalid uppercase name.
---
"""

    with pytest.raises(MdaConfigError) as exc_info:
        load_mda_source_from_bytes(source, schema=MinimalSchema)

    assert exc_info.value.category is ErrorCategory.SchemaViolation
