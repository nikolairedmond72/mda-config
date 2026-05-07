/**
 * MDA §11-2 — canonical loader algorithm (Stages A → G).
 *
 * v1.0 implements the source-mode path only. Stages:
 *   A. Extract frontmatter + body (§02-1.1).
 *   B. Validate against the MDA source-mode JSON Schema (§02).
 *   C. §09-2 cross-field signature/integrity check.
 *   D. (Optional) §08-4 integrity verification.
 *   E. (Optional) §09-4.2 Sigstore signature verification.
 *   F. (Optional) §10-4 `requires.network` enforcement.
 *   G. (Optional) Consumer Zod schema (§11-4).
 */

import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { ZodTypeAny, infer as ZodInfer } from "zod";
import { ErrorCategory, MdaConfigError } from "./errors.js";
import {
  extractFrontmatter,
  parseFrontmatterYaml,
} from "./frontmatter.js";
import {
  type IntegrityField,
  verifyIntegrity as runIntegrityCheck,
} from "./integrity.js";
import { MDA_SOURCE_SCHEMA } from "./mda-schema.js";
import {
  enforceRequires,
  type RequiresBlock,
  type RequiresEnvironment,
} from "./requires-check.js";
import {
  type RekorClient,
  type SignatureEntry,
  type TrustPolicy,
  verifySignatures as runSignatureCheck,
} from "./signature.js";

/** Options accepted by `loadMdaSource()`. */
export interface LoadMdaSourceOptions extends RequiresEnvironment {
  /** Stage D — verify §08 integrity. */
  verifyIntegrity?: boolean;
  /** Stage E — verify §09 signatures. */
  verifySignatures?: boolean;
  /** Stage F — enforce §10-3.3 `requires.network`. */
  enforceRequires?: boolean;
  /** Operator trust policy (required when `verifySignatures` is true). */
  trustPolicy?: TrustPolicy;
  /** Pluggable Rekor client (required when `verifySignatures` is true). */
  rekorClient?: RekorClient;
}

let cachedValidator: ValidateFunction | null = null;
function mdaSourceValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;
  // Ajv 2020-12 mode (PRD §6).
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  // ajv-formats default export type varies across CJS/ESM.
  const addFormatsFn = (addFormats as unknown as { default?: (a: unknown) => void }).default ??
    (addFormats as unknown as (a: unknown) => void);
  addFormatsFn(ajv);
  const validator = ajv.compile(MDA_SOURCE_SCHEMA) as ValidateFunction;
  cachedValidator = validator;
  return validator;
}

/** MDA §11-2 — load and verify a `.mda` source-mode file through Stages A → G. */
export async function loadMdaSource<S extends ZodTypeAny>(
  path: string,
  projectSchema: S,
  options: LoadMdaSourceOptions = {},
): Promise<ZodInfer<S>> {
  const fileBytes = await readFile(path);
  return await loadMdaSourceFromBytes(fileBytes, projectSchema, options);
}

/** MDA §11-2 — same as `loadMdaSource` but operates on raw bytes for tests. */
export async function loadMdaSourceFromBytes<S extends ZodTypeAny>(
  fileBytes: Uint8Array,
  projectSchema: S,
  options: LoadMdaSourceOptions = {},
): Promise<ZodInfer<S>> {
  // === Stage A: §02-1.1 extraction ==========================================
  const { frontmatterStr, bodyStr } = extractFrontmatter(fileBytes);
  if (frontmatterStr === "") {
    // Source-mode `.mda` always requires frontmatter (PRD §2; only AGENTS.md
    // outputs admit body-only, and that is the compile target's domain).
    throw new MdaConfigError(
      ErrorCategory.MissingRequiredFrontmatter,
      "source-mode .mda file has no opening '---' fence",
    );
  }
  const frontmatter = parseFrontmatterYaml(frontmatterStr);

  // === Stage B: MDA source-schema structural validation ====================
  const validate = mdaSourceValidator();
  if (!validate(frontmatter)) {
    throw new MdaConfigError(
      ErrorCategory.SchemaViolation,
      "frontmatter failed MDA source-mode JSON Schema validation",
      { errors: validate.errors ?? [] },
    );
  }

  // === Stage C: §09-2 cross-field semantics =================================
  const integrity = frontmatter.integrity as IntegrityField | undefined;
  const signatures = frontmatter.signatures as SignatureEntry[] | undefined;
  if (signatures && signatures.length > 0) {
    if (!integrity) {
      // Schema's dependentRequired catches this too; Stage C states it loud.
      throw new MdaConfigError(
        ErrorCategory.SignaturesWithoutIntegrity,
        "signatures[] present without integrity",
      );
    }
    for (const sig of signatures) {
      if (sig["payload-digest"] !== integrity.digest) {
        throw new MdaConfigError(
          ErrorCategory.SignatureDigestMismatch,
          "signatures[i].payload-digest does not equal integrity.digest",
          { signer: sig.signer, expected: integrity.digest, actual: sig["payload-digest"] },
        );
      }
    }
  }

  // === Stage D: §08-4 integrity verification (gated) ========================
  if (options.verifyIntegrity && integrity) {
    runIntegrityCheck(frontmatter, bodyStr, integrity);
  }

  // === Stage E: §09-4.2 Sigstore signature verification (gated) =============
  if (options.verifySignatures && signatures && signatures.length > 0) {
    if (!integrity) {
      throw new MdaConfigError(
        ErrorCategory.SignaturesWithoutIntegrity,
        "cannot verify signatures without an integrity anchor",
      );
    }
    if (!options.trustPolicy) {
      throw new MdaConfigError(
        ErrorCategory.UntrustedIssuer,
        "verifySignatures=true requires options.trustPolicy",
      );
    }
    if (!options.rekorClient) {
      throw new MdaConfigError(
        ErrorCategory.RekorInclusionFailure,
        "verifySignatures=true requires options.rekorClient",
      );
    }
    await runSignatureCheck(signatures, integrity, options.trustPolicy, {
      rekorClient: options.rekorClient,
    });
  }

  // === Stage F: §10-4 requires enforcement (gated, source-mode top-level) ==
  if (options.enforceRequires) {
    const requires = frontmatter.requires as RequiresBlock | undefined;
    enforceRequires(requires, { allowedNetworks: options.allowedNetworks });
  }

  // === Stage G: consumer Zod schema (§11-4 layering) ========================
  const result = projectSchema.safeParse(frontmatter);
  if (!result.success) {
    throw new MdaConfigError(
      ErrorCategory.ProjectSchemaViolation,
      "consumer Zod schema rejected the frontmatter",
      { issues: result.error.issues },
    );
  }
  return result.data as ZodInfer<S>;
}
