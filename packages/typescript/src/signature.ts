/**
 * MDA §09 — DSSE PAE construction and Sigstore signature verification.
 *
 * The hot path for production verification:
 *   1. §09-2 cross-field check (already done in loader Stage C).
 *   2. §09-3.1 PAE reconstruction from `integrity` (using the optional
 *      `signatures[i].payload-type` or its default).
 *   3. Fetch the Rekor entry by `(rekor-log-id, rekor-log-index)`.
 *   4. §09-4.2 step 3 — REJECT unless entry kind is `dsse-v0.0.1`.
 *   5. Reconstruct a Sigstore SerializedBundle from (rekor entry, cert,
 *      signature) and hand it to the official `sigstore` npm package's
 *      `verify()`. This delegates Fulcio chain + transparency-log inclusion
 *      crypto to upstream so we never reinvent it.
 *   6. After cryptographic verification succeeds, enforce the operator's
 *      trust policy: cert SAN must match `{issuer, identityPattern}`.
 *
 * The Rekor client is injectable so callers can choose their lookup transport;
 * Sigstore crypto always goes through the official npm package.
 */

import { canonify } from "@truestamp/canonify";
import { verify as sigstoreVerify } from "sigstore";
import type { Bundle as SerializedBundle } from "sigstore";
import { Buffer } from "node:buffer";
import { ErrorCategory, MdaConfigError } from "./errors.js";
import type { IntegrityField } from "./integrity.js";

/** §09-2 — one entry of the top-level `signatures[]` array. */
export interface SignatureEntry {
  signer: string;
  "key-id": string;
  "payload-digest": string;
  algorithm: "ed25519" | "ecdsa-p256" | "rsa-pss-sha256";
  signature: string;
  "rekor-log-id"?: string;
  "rekor-log-index"?: number;
  "payload-type"?: string;
}

/** §09-2 — default DSSE payload-type when `signatures[i].payload-type` is absent. */
export const DEFAULT_PAYLOAD_TYPE = "application/vnd.mda.integrity+json";

/** Rekor `dsse-v0.0.1` entry (subset relevant for verification). */
export interface RekorEntry {
  /** §09-4.2 step 3 — entry kind. */
  kind: "dsse-v0.0.1" | string;
  /** PEM-encoded Fulcio leaf certificate the entry references. */
  certificatePem: string;
  /** Original DSSE envelope JSON the entry indexes. */
  dsseEnvelope: {
    payloadType: string;
    payload: string; // base64 of the canonical payload bytes
    signatures: { sig: string; keyid?: string }[];
  };
  /** Inclusion proof bytes (caller passes through to sigstore.verify()). */
  inclusionProof?: unknown;
  /** Integrated time (seconds since epoch), for SerializedBundle reconstruction. */
  integratedTime?: number;
  /** Set of pre-baked SerializedBundle fields the client may pass through. */
  rawBundle?: SerializedBundle;
}

/** Operator trust policy for Sigstore signature verification. */
export interface TrustPolicy {
  allowedSigners: AllowedSigner[];
}

/** §09-7 — operator-defined per-signer allow-list. */
export interface AllowedSigner {
  /** OIDC issuer URL claim. */
  issuer: string;
  /** Regex over the cert's SAN identity (email or URI). */
  identityPattern: RegExp;
}

/** Pluggable Rekor lookup. */
export interface RekorClient {
  fetchEntry(logId: string, logIndex: number): Promise<RekorEntry | null>;
}

/** §09-4.2 step 6 — verified identity surfaced by the Sigstore verifier. */
export interface SigstoreVerificationResult {
  certificatePem?: string;
  identity?: {
    issuer?: string;
    subjectAlternativeName?: string;
  };
}

async function verifySigstoreBundle(
  bundle: SerializedBundle,
  payload: Buffer,
): Promise<SigstoreVerificationResult> {
  // sigstore.verify resolves on success; throws VerificationError otherwise.
  const signer = await sigstoreVerify(bundle, payload);
  return {
    certificatePem: extractCertFromBundle(bundle),
    identity: {
      issuer: signer.identity?.extensions?.issuer,
      subjectAlternativeName: signer.identity?.subjectAlternativeName,
    },
  };
}

/** §09-3.1 — construct DSSE PAE bytes for the (payloadType, payloadBytes) pair. */
export function constructDssePae(
  payloadType: string,
  payloadBytes: Uint8Array,
): Uint8Array {
  // PAE = "DSSEv1" SP len(type) SP type SP len(payload) SP payload
  const head = `DSSEv1 ${payloadType.length} ${payloadType} ${payloadBytes.length} `;
  const headBytes = new TextEncoder().encode(head);
  const out = new Uint8Array(headBytes.length + payloadBytes.length);
  out.set(headBytes, 0);
  out.set(payloadBytes, headBytes.length);
  return out;
}

/** §09-3.1 — JCS-canonicalize the unstripped `integrity` object for PAE. */
export function paePayloadBytes(integrity: IntegrityField): Uint8Array {
  return new TextEncoder().encode(canonify(integrity));
}

/** §09-4.2 — verify all `signatures[]` entries against the operator policy. */
export async function verifySignatures(
  signatures: SignatureEntry[],
  integrity: IntegrityField,
  policy: TrustPolicy,
  options: { rekorClient: RekorClient } = {
    rekorClient: defaultRekorClient,
  },
): Promise<void> {
  for (const sig of signatures) {
    // §09-2 cross-field check (also done in loader Stage C; keep here for
    // direct callers of verifySignatures()).
    if (sig["payload-digest"] !== integrity.digest) {
      throw new MdaConfigError(
        ErrorCategory.SignatureDigestMismatch,
        "signature payload-digest does not equal integrity.digest",
        { signer: sig.signer },
      );
    }

    if (sig.signer.startsWith("did-web:")) {
      // PRD §2 — `did:web` is out of scope for v1.0.
      throw new MdaConfigError(
        ErrorCategory.UnknownSignerMethod,
        "did:web signatures are not supported in v1.0 (use Sigstore OIDC)",
        { signer: sig.signer },
      );
    }
    if (!sig.signer.startsWith("sigstore-oidc:")) {
      throw new MdaConfigError(
        ErrorCategory.UnknownSignerMethod,
        "unknown signer method (expected 'sigstore-oidc:' prefix)",
        { signer: sig.signer },
      );
    }

    // §09-3.1 — reconstruct PAE bytes.
    const payloadType = sig["payload-type"] ?? DEFAULT_PAYLOAD_TYPE;
    const paeBytes = constructDssePae(payloadType, paePayloadBytes(integrity));

    // §09-4.2 step 3 — Rekor entry kind MUST be `dsse-v0.0.1`.
    const logId = sig["rekor-log-id"];
    const logIndex = sig["rekor-log-index"];
    if (!logId || logIndex === undefined) {
      throw new MdaConfigError(
        ErrorCategory.RekorInclusionFailure,
        "Sigstore signature missing rekor-log-id or rekor-log-index",
        { signer: sig.signer },
      );
    }
    const entry = await options.rekorClient.fetchEntry(logId, logIndex);
    if (!entry) {
      throw new MdaConfigError(
        ErrorCategory.RekorInclusionFailure,
        "Rekor entry not found for the supplied log coordinates",
        { logId, logIndex },
      );
    }
    if (entry.kind !== "dsse-v0.0.1") {
      throw new MdaConfigError(
        ErrorCategory.RekorEntryTypeMismatch,
        `Rekor entry kind '${entry.kind}' is not 'dsse-v0.0.1'`,
        { logId, logIndex, kind: entry.kind },
      );
    }

    // §09-4.2 steps 4-7 — delegate Fulcio chain + inclusion + signature crypto
    // to the official `sigstore` package via a SerializedBundle.
    const bundle = entry.rawBundle ?? buildBundleFromEntry(entry, sig, paeBytes);
    let verification: SigstoreVerificationResult;
    try {
      verification = await verifySigstoreBundle(bundle, Buffer.from(paeBytes));
    } catch (cause) {
      throw new MdaConfigError(
        ErrorCategory.SignatureVerificationFailure,
        "Sigstore verification failed",
        { signer: sig.signer, cause: (cause as Error).message },
      );
    }

    // §09-4.2 step 6 — enforce operator trust policy.
    enforceTrustPolicy(verification, policy, sig);
  }
}

/** §09-4.2 step 6 — match the cert's SAN identity against the operator policy. */
function enforceTrustPolicy(
  verification: SigstoreVerificationResult,
  policy: TrustPolicy,
  sig: SignatureEntry,
): void {
  // signer = "sigstore-oidc:<issuer-url>" → extract the OIDC issuer claim.
  const signerIssuer = sig.signer.slice("sigstore-oidc:".length);
  const issuer = verification.identity?.issuer ?? signerIssuer;
  const identity =
    verification.identity?.subjectAlternativeName ??
    extractCertIdentity(verification.certificatePem ?? "");
  if (issuer !== signerIssuer) {
    throw new MdaConfigError(
      ErrorCategory.UntrustedIssuer,
      "verified Sigstore issuer does not match signatures[i].signer",
      { issuer, signerIssuer, signer: sig.signer },
    );
  }
  for (const allow of policy.allowedSigners) {
    if (allow.issuer !== issuer) continue;
    if (allow.identityPattern.test(identity)) return;
  }
  throw new MdaConfigError(
    ErrorCategory.UntrustedIssuer,
    "signer identity not in operator trust policy",
    { issuer, identity, signer: sig.signer },
  );
}

/** Extract the SAN identity (email or URI) from a Fulcio leaf certificate. */
function extractCertIdentity(certPem: string): string {
  // Minimal pull: we look for an X509v3 SAN otherName / rfc822Name / URI in
  // the PEM's text representation. Real cert parsing is delegated to
  // `sigstore` for cryptographic verification; we only need the identity
  // string for policy matching here. The `sigstore-js` ecosystem stores the
  // identity claim as either an email (rfc822Name) or a URI (URI).
  // Tests inject a deterministic identity via the verifier stub.
  // Fallback heuristic: search for "URI:" or "email:" in the PEM payload.
  const uri = certPem.match(/URI:([^\s,]+)/);
  if (uri && uri[1]) return uri[1];
  const email = certPem.match(/email:([^\s,]+)/);
  if (email && email[1]) return email[1];
  // Fall back to the raw PEM so policy matching FAILS LOUD rather than
  // silently passing on a parsing miss. Operators see the cert and adjust.
  return certPem;
}

/** Pull the leaf cert PEM out of a SerializedBundle (best-effort). */
function extractCertFromBundle(bundle: SerializedBundle): string {
  const chain = bundle.verificationMaterial?.x509CertificateChain?.certificates;
  if (chain && chain.length > 0 && chain[0] && chain[0].rawBytes) {
    const der = Buffer.from(chain[0].rawBytes, "base64");
    return derToPem(der);
  }
  // Some bundle profiles use `certificate` instead of `x509CertificateChain`.
  const cert = (bundle.verificationMaterial as { certificate?: { rawBytes: string } })
    ?.certificate;
  if (cert?.rawBytes) {
    const der = Buffer.from(cert.rawBytes, "base64");
    return derToPem(der);
  }
  return "";
}

function derToPem(der: Buffer): string {
  const b64 = der.toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

/**
 * Reconstruct a SerializedBundle from a fetched Rekor `dsse-v0.0.1` entry.
 * Most production callers will fetch a pre-baked bundle from Rekor's GET
 * endpoint and pass it via `entry.rawBundle`; this fallback exists so the
 * minimal `RekorEntry` shape is sufficient for testing.
 */
function buildBundleFromEntry(
  entry: RekorEntry,
  _sig: SignatureEntry,
  _paeBytes: Uint8Array,
): SerializedBundle {
  const certB64 = pemToB64(entry.certificatePem);
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {
      x509CertificateChain: {
        certificates: [{ rawBytes: certB64 }],
      },
      tlogEntries: [],
      timestampVerificationData: { rfc3161Timestamps: [] },
    },
    dsseEnvelope: {
      payloadType: entry.dsseEnvelope.payloadType,
      payload: entry.dsseEnvelope.payload,
      signatures: entry.dsseEnvelope.signatures.map((s) => ({
        sig: s.sig,
        keyid: s.keyid ?? "",
      })),
    },
  } as unknown as SerializedBundle;
}

function pemToB64(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

/** Default Rekor client (placeholder — operators provide their own at v1.0). */
const defaultRekorClient: RekorClient = {
  async fetchEntry() {
    throw new MdaConfigError(
      ErrorCategory.RekorInclusionFailure,
      "no Rekor client configured; supply options.rekorClient when verifying signatures",
    );
  },
};
