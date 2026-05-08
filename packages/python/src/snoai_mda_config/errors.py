"""MDA §11-3 error vocabulary mirrored from the TypeScript loader."""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCategory(StrEnum):
    """MDA §11-3 recommended error category vocabulary."""

    InvalidEncoding = "invalid-encoding"
    UnterminatedFrontmatter = "unterminated-frontmatter"
    MissingRequiredFrontmatter = "missing-required-frontmatter"
    FrontmatterYamlParseError = "frontmatter-yaml-parse-error"
    SchemaViolation = "schema-violation"
    SignatureDigestMismatch = "signature-digest-mismatch"
    SignaturesWithoutIntegrity = "signatures-without-integrity"
    IntegrityMismatch = "integrity-mismatch"
    RekorEntryTypeMismatch = "rekor-entry-type-mismatch"
    RekorInclusionFailure = "rekor-inclusion-failure"
    FulcioChainFailure = "fulcio-chain-failure"
    SignatureVerificationFailure = "signature-verification-failure"
    UntrustedIssuer = "untrusted-issuer"
    UntrustedDidWebDomain = "untrusted-did-web-domain"
    UnknownSignerMethod = "unknown-signer-method"
    RequiresNotSatisfied = "requires-not-satisfied"
    ProjectSchemaViolation = "project-schema-violation"

    INVALID_ENCODING = InvalidEncoding
    UNTERMINATED_FRONTMATTER = UnterminatedFrontmatter
    MISSING_REQUIRED_FRONTMATTER = MissingRequiredFrontmatter
    FRONTMATTER_YAML_PARSE_ERROR = FrontmatterYamlParseError
    SCHEMA_VIOLATION = SchemaViolation
    SIGNATURE_DIGEST_MISMATCH = SignatureDigestMismatch
    SIGNATURES_WITHOUT_INTEGRITY = SignaturesWithoutIntegrity
    INTEGRITY_MISMATCH = IntegrityMismatch
    REKOR_ENTRY_TYPE_MISMATCH = RekorEntryTypeMismatch
    REKOR_INCLUSION_FAILURE = RekorInclusionFailure
    FULCIO_CHAIN_FAILURE = FulcioChainFailure
    SIGNATURE_VERIFICATION_FAILURE = SignatureVerificationFailure
    UNTRUSTED_ISSUER = UntrustedIssuer
    UNTRUSTED_DID_WEB_DOMAIN = UntrustedDidWebDomain
    UNKNOWN_SIGNER_METHOD = UnknownSignerMethod
    REQUIRES_NOT_SATISFIED = RequiresNotSatisfied
    PROJECT_SCHEMA_VIOLATION = ProjectSchemaViolation


class MdaConfigError(Exception):
    """MDA §11-3 structured error raised by public loader functions."""

    def __init__(
        self,
        category: ErrorCategory,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(f"[{category.value}] {message}")
        self.category = category
        self.details = details or {}
