import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sigstore", () => ({
  verify: vi.fn(),
}));

import { resolve } from "node:path";
import { verify as sigstoreVerify } from "sigstore";
import { z } from "zod";
import { loadMdaSource } from "../src/loader.js";
import { ErrorCategory, MdaConfigError } from "../src/errors.js";
import type { RekorClient, RekorEntry } from "../src/signature.js";

const FIX = (rel: string) =>
  resolve(__dirname, "../../../fixtures", rel);

const mockSigstoreVerify = vi.mocked(sigstoreVerify);

beforeEach(() => {
  mockSigstoreVerify.mockReset();
});

function mockVerifiedSigstoreIdentity(identity: string): void {
  mockSigstoreVerify.mockResolvedValue({
    identity: {
      extensions: { issuer: "https://accounts.google.com" },
      subjectAlternativeName: identity,
    },
  } as Awaited<ReturnType<typeof sigstoreVerify>>);
}

const MinimalSchema = z.object({
  name: z.string(),
  description: z.string(),
  metadata: z
    .object({
      mda: z
        .object({
          version: z.string().optional(),
          "doc-id": z.string().optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  requires: z.object({ network: z.array(z.string()).optional() }).optional(),
  integrity: z
    .object({ algorithm: z.string(), digest: z.string() })
    .optional(),
  signatures: z.array(z.unknown()).optional(),
});

describe("loadMdaSource — Stage A → D + G (no signatures, no requires)", () => {
  it("loads a minimal source-mode .mda file", async () => {
    const cfg = await loadMdaSource(FIX("valid/01-minimal.mda"), MinimalSchema);
    expect(cfg.name).toBe("minimal-config");
  });

  it("rejects YAML parse errors with frontmatter-yaml-parse-error", async () => {
    try {
      await loadMdaSource(FIX("invalid/10-yaml-parse-error.mda"), MinimalSchema);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.FrontmatterYamlParseError);
    }
  });

  it("rejects integrity mismatch with integrity-mismatch", async () => {
    try {
      await loadMdaSource(FIX("invalid/11-integrity-mismatch.mda"), MinimalSchema, {
        verifyIntegrity: true,
      });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.IntegrityMismatch);
    }
  });

  it("rejects signature-digest-mismatch via Stage C", async () => {
    try {
      await loadMdaSource(FIX("invalid/12-signature-digest-mismatch.mda"), MinimalSchema);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.SignatureDigestMismatch);
    }
  });

  it("verifies integrity when verifyIntegrity=true", async () => {
    const cfg = await loadMdaSource(FIX("valid/02-with-integrity.mda"), MinimalSchema, {
      verifyIntegrity: true,
    });
    expect(cfg.integrity?.algorithm).toBe("sha256");
  });

  it("Stage G: surfaces project-schema-violation when consumer Zod fails", async () => {
    const NarrowSchema = z.object({
      name: z.literal("does-not-match"),
      description: z.string(),
    });
    try {
      await loadMdaSource(FIX("valid/01-minimal.mda"), NarrowSchema);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.ProjectSchemaViolation);
    }
  });
});

describe("loadMdaSource — Stage F (requires.network)", () => {
  it("accepts when network host is in allowedNetworks", async () => {
    const cfg = await loadMdaSource(
      FIX("valid/04-with-requires-network.mda"),
      MinimalSchema,
      {
        enforceRequires: true,
        allowedNetworks: ["api.openai.com"],
      },
    );
    expect(cfg.requires?.network).toContain("api.openai.com");
  });

  it("accepts when operator allow-list has a matching host glob", async () => {
    const cfg = await loadMdaSource(
      FIX("valid/04-with-requires-network.mda"),
      MinimalSchema,
      {
        enforceRequires: true,
        allowedNetworks: ["*.openai.com"],
      },
    );
    expect(cfg.requires?.network).toContain("api.openai.com");
  });

  it("rejects invalid requires.network shape in Stage F", async () => {
    const { loadMdaSourceFromBytes } = await import("../src/loader.js");
    const src = `---
name: bad-network-shape
description: requires.network value is invalid
requires:
  network: 7
---
`;
    try {
      await loadMdaSourceFromBytes(new TextEncoder().encode(src), MinimalSchema, {
        enforceRequires: true,
      });
      throw new Error("expected throw");
    } catch (e) {
      const err = e as MdaConfigError;
      expect(err.category).toBe(ErrorCategory.RequiresNotSatisfied);
      expect(err.details).toMatchObject({
        key: "network",
        reason: "invalid-shape",
        got: 7,
      });
    }
  });

  it("rejects when host is not in allowedNetworks", async () => {
    try {
      await loadMdaSource(FIX("invalid/15-network-violation.mda"), MinimalSchema, {
        enforceRequires: true,
        allowedNetworks: ["api.openai.com"],
      });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.RequiresNotSatisfied);
    }
  });
});

// ────────────────── Stage E: Sigstore signature verification ──────────────────

/** A mock Rekor client that returns the supplied entry for any (id, idx). */
function mockRekor(entry: RekorEntry | null): RekorClient {
  return {
    async fetchEntry() {
      return entry;
    },
  };
}

describe("loadMdaSource — Stage E (Sigstore signatures)", () => {
  it("accepts a sigstore-signed fixture under a passing verifier + matching trust policy", async () => {
    mockVerifiedSigstoreIdentity("releases@snoai.com");
    const cfg = await loadMdaSource(
      FIX("valid/03-sigstore-signed.mda"),
      MinimalSchema,
      {
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
        rekorClient: mockRekor({
          kind: "dsse-v0.0.1",
          certificatePem:
            "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n",
          dsseEnvelope: { payloadType: "x", payload: "x", signatures: [{ sig: "x" }] },
        }),
      },
    );
    expect(cfg.integrity?.digest).toMatch(/^sha256:/);
  });

  it("rejects when Rekor entry kind is not dsse-v0.0.1", async () => {
    try {
      await loadMdaSource(
        FIX("invalid/14-rekor-entry-type-wrong.mda"),
        MinimalSchema,
        {
          verifyIntegrity: true,
          verifySignatures: true,
          trustPolicy: {
            allowedSigners: [
              {
                issuer: "https://accounts.google.com",
                identityPattern: /.*/,
              },
            ],
          },
          rekorClient: mockRekor({
            kind: "hashedrekord-v0.0.1",
            certificatePem: "",
            dsseEnvelope: { payloadType: "x", payload: "x", signatures: [{ sig: "x" }] },
          }),
        },
      );
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.RekorEntryTypeMismatch);
    }
  });

  it("rejects when cert identity does not match the trust policy", async () => {
    mockVerifiedSigstoreIdentity("releases@snoai.com");
    try {
      await loadMdaSource(
        FIX("valid/03-sigstore-signed.mda"),
        MinimalSchema,
        {
          verifyIntegrity: true,
          verifySignatures: true,
          trustPolicy: {
            allowedSigners: [
              {
                issuer: "https://accounts.google.com",
                identityPattern: /^someone-else@example\.com$/,
              },
            ],
          },
          rekorClient: mockRekor({
            kind: "dsse-v0.0.1",
            certificatePem: "",
            dsseEnvelope: { payloadType: "x", payload: "x", signatures: [{ sig: "x" }] },
          }),
        },
      );
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.UntrustedIssuer);
    }
  });

  it("rejects did-web signers as out-of-scope (PRD §2)", async () => {
    // synthesize a fixture path? simpler: hand-craft via loadMdaSourceFromBytes
    const { loadMdaSourceFromBytes } = await import("../src/loader.js");
    const src = `---
name: did-web-attempt
description: did-web is out of scope for v1.0
integrity:
  algorithm: sha256
  digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
signatures:
  - signer: "did-web:example.com"
    key-id: "ed25519-9c4e7b"
    payload-digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    algorithm: ed25519
    signature: "BASE64=="
---
`;
    try {
      await loadMdaSourceFromBytes(new TextEncoder().encode(src), MinimalSchema, {
        verifySignatures: true,
        trustPolicy: { allowedSigners: [] },
        rekorClient: { async fetchEntry() { return null; } },
      });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as MdaConfigError).category).toBe(ErrorCategory.UnknownSignerMethod);
    }
  });
});
