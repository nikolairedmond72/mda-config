/**
 * LLMix dogfood (PRD §10 Appendix A acceptance):
 *   tests/fixtures/sample_preset.mda loads + integrity-verifies + enforces
 *   requires.network end-to-end against an LLMix-shaped Zod schema. Sigstore is
 *   mocked at the package boundary; Stage E mechanics are covered here.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sigstore", () => ({
  verify: vi.fn(),
}));

import { resolve } from "node:path";
import { verify as sigstoreVerify } from "sigstore";
import { z } from "zod";
import { loadMdaSource } from "../src/loader.js";
import type { RekorClient } from "../src/signature.js";

const FIX = resolve(__dirname, "fixtures/sample_preset.mda");
const mockSigstoreVerify = vi.mocked(sigstoreVerify);

beforeEach(() => {
  mockSigstoreVerify.mockReset();
});

// Minimal LLMix Zod shape (mirrors apps/llmix-cli/src/yaml-loader.ts in spirit).
const LLMixPresetSchema = z.object({
  name: z.string(),
  description: z.string(),
  requires: z
    .object({ network: z.array(z.string()).optional() })
    .optional(),
  metadata: z.object({
    mda: z
      .object({
        version: z.string().optional(),
        "doc-id": z.string().optional(),
        tags: z.array(z.string()).optional(),
      })
      .optional(),
    "snoai-llmix": z.object({
      common: z.object({
        model: z.string(),
        provider: z.string(),
        temperature: z.number().optional(),
        maxOutputTokens: z.number().optional(),
      }),
      providerOptions: z.record(z.string(), z.unknown()).optional(),
      caching: z.object({ strategy: z.string() }).optional(),
    }),
  }),
  integrity: z.object({ algorithm: z.string(), digest: z.string() }).optional(),
  signatures: z.array(z.unknown()).optional(),
});

describe("LLMix dogfood — sample_preset.mda", () => {
  it("loads + integrity-verifies + signature-verifies + enforces requires.network", async () => {
    mockSigstoreVerify.mockResolvedValue({
      identity: {
        extensions: { issuer: "https://accounts.google.com" },
        subjectAlternativeName: "releases@snoai.com",
      },
    } as Awaited<ReturnType<typeof sigstoreVerify>>);
    const rekorClient: RekorClient = {
      async fetchEntry() {
        return {
          kind: "dsse-v0.0.1",
          certificatePem: "",
          dsseEnvelope: { payloadType: "x", payload: "x", signatures: [{ sig: "x" }] },
        };
      },
    };
    const cfg = await loadMdaSource(FIX, LLMixPresetSchema, {
      verifyIntegrity: true,
      verifySignatures: true,
      enforceRequires: true,
      allowedNetworks: ["api.openai.com"],
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
    expect(cfg.name).toBe("gpt5-mini-fast");
    expect(cfg.metadata["snoai-llmix"].common.model).toBe("gpt-5-mini");
    expect(cfg.requires?.network).toEqual(["api.openai.com"]);
  });
});
