# Trust policy

`@snoai/mda-config` performs Sigstore signature verification in three stages:

1. **Cryptographic verification.** Delegated to the official `sigstore` npm package: Fulcio chain to the Sigstore root + transparency-log inclusion proof against Rekor.
2. **Rekor entry kind enforcement.** MDA §09-4.2 step 3 — the Rekor entry MUST be `dsse-v0.0.1`. Other kinds (`hashedrekord-v0.0.1`, `intoto-v0.0.2`, …) are rejected with `rekor-entry-type-mismatch`.
3. **Identity policy.** After cryptographic verification succeeds, the cert's SAN identity is matched against the operator's allow-list.

## Operator policy shape

```ts
import { loadMdaSource } from "@snoai/mda-config";

await loadMdaSource(path, schema, {
  verifySignatures: true,
  trustPolicy: {
    allowedSigners: [
      {
        issuer: "https://accounts.google.com",
        identityPattern: /^releases@snoai\.com$/,
      },
      {
        issuer: "https://token.actions.githubusercontent.com",
        identityPattern: /^https:\/\/github\.com\/snoai\/.+$/,
      },
    ],
  },
  rekorClient: yourRekorClient,
});
```

- `issuer` is the OIDC issuer URL that appears in the Sigstore signer field (`sigstore-oidc:<issuer>`).
- `identityPattern` is a regex tested against the cert's SAN identity (email or URI). The regex is your security boundary — anchor it with `^…$` to avoid prefix-match bypass.

## Rekor client

`@snoai/mda-config` does not ship a Rekor HTTP client. Wire one via the `rekorClient` option:

```ts
const rekorClient: RekorClient = {
  async fetchEntry(logId, logIndex) {
    const resp = await fetch(`https://rekor.sigstore.dev/api/v1/log/entries/${logIndex}`);
    if (!resp.ok) return null;
    return await resp.json() as RekorEntry; // shape per signature.ts
  },
};
```

Cache, retry, and timeout policy is the operator's call.

## Default-deny

Verification is default-deny:

- No `trustPolicy` → `verifySignatures: true` rejects every artifact (`untrusted-issuer`).
- No `rekorClient` → `verifySignatures: true` rejects every artifact (`rekor-inclusion-failure`).
- A cert whose SAN identity matches no `allowedSigners` entry is rejected with `untrusted-issuer`.

## What we do NOT verify (boundary)

- Long-lived X.509 chains outside Sigstore.
- `did:web` signatures — rejected with `unknown-signer-method` per PRD §2.
- Hardware-key-anchored signatures — out of scope per MDA §12-7.
- Rekor entries from non-public Sigstore deployments — verification works as long as the bundle the operator's Rekor client returns satisfies the official `sigstore` client.
