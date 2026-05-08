"""Python loader for MDA v1.0 source-mode configuration artifacts."""

from .errors import ErrorCategory, MdaConfigError
from .frontmatter import ExtractedFrontmatter, extract_frontmatter, parse_frontmatter_yaml
from .integrity import (
    IntegrityField,
    canonicalize_artifact,
    hash_canonical,
    normalize_body,
    parse_digest,
    verify_integrity,
)
from .loader import load_mda_source, load_mda_source_from_bytes

__all__ = [
    "ErrorCategory",
    "ExtractedFrontmatter",
    "IntegrityField",
    "MdaConfigError",
    "canonicalize_artifact",
    "extract_frontmatter",
    "hash_canonical",
    "load_mda_source",
    "load_mda_source_from_bytes",
    "normalize_body",
    "parse_digest",
    "parse_frontmatter_yaml",
    "verify_integrity",
]
