# CKB "Create a DOB" Tutorial — Completion & Technical Deep Dive

This document records the full process of completing Nervos CKB's ["Create a DOB"](https://docs.nervos.org/docs/dapp/create-dob) tutorial — deploying an on-chain digital object with an embedded image via Spore-SDK, rendering it back from the blockchain, and deploying to the public CKB testnet.

## 1. Environment Setup

| Component | Version |
| --- | --- |
| OS | Windows (native, no WSL) |
| Node.js | v24.11.1 |
| npm | 11.12.1 |
| Git | 2.52.0 |
| OffCKB CLI | 0.4.13 |

**Steps taken:**
- Verified Node.js, npm, and Git installations.
- Installed the OffCKB CLI globally: `npm install -g @offckb/cli`.
- Cloned the tutorial repository, located the project at `examples/dApp/create-dob`.
- Started a local CKB Devnet (`offckb node`) for initial development and testing.
- Installed project dependencies via `npm install` (this project uses npm + Parcel, not pnpm — a different toolchain than prior CKB tutorial work).
- Ran the dev server: `$env:NETWORK="devnet"; npm start` (PowerShell-specific syntax — the tutorial's documented `NETWORK=devnet npm start` is Unix shell syntax and does not work natively on Windows).

## 2. What Is a DOB (Digital Object)?

A DOB is built on Spore Protocol, CKB's native standard for on-chain digital assets. Unlike most NFT standards — which typically store only a pointer (a URL or IPFS hash) to media hosted off-chain — a Spore Cell stores the actual content bytes directly on-chain, secured by CKB's cell model and paid for via real, locked CKB capacity (storage is not free; it is economically backed).

This has direct, practical consequences explored throughout this project:
- **Permanence and immutability:** once minted, a Spore Cell's content-type and content cannot be altered.
- **Real economic cost of storage:** CKB capacity costs approximately 1 CKB per byte, meaning on-chain storage is a genuine, tangible cost — not an abstraction. This was directly encountered (see Section 4).
- **No dependency on external infrastructure:** the asset does not "break" if an off-chain server or IPFS pin disappears, since the data lives on the chain itself.

## 3. Devnet Deployment — Initial Proof

- Created a Spore Cell containing a PNG image via the app's "Create DOB" flow.
- Confirmed on-chain: transaction hash `0xca6168595817d7d813793bee257121482c86fee841bf642304e3c64301827168`
- Rendered the image back in-browser via "Check Spore Content," confirming the full round-trip: image → on-chain bytes → retrieved and displayed.

## 4. Testnet Deployment — Full Requirement

### Network Switch
Switched the app to testnet: `$env:NETWORK="testnet"; npm start`. Verified via code review of `ccc-client.ts` that this correctly instantiates `ccc.ClientPublicTestnet()` — a genuine connection to the public network, not a local override.

### Wallet Security Consideration
The tutorial's default private key is a widely-published example key present in every offckb accounts output — used by virtually every developer following any CKB tutorial. Using this key on a real public network (even with worthless testnet funds) is poor practice, since anyone possessing the same well-known key could spend from that address. A fresh private key was generated locally using Node's cryptographically secure random generator, ensuring a genuinely unique testnet identity.

### Funding via Faucet
Used the official Nervos Pudge Faucet (`faucet.nervos.org`) to claim 10,000 testnet CKB into the newly generated address. Verified receipt independently via the CKB testnet block explorer, rather than relying solely on the app's own balance display.

### The Capacity Error — A Real Debugging Story
The first testnet mint attempt (using a 218 KB image) failed with:
`Unhandled Rejection (Error): Not enough capacity in from infos!`

This was diagnosed as a direct consequence of CKB's ~1-CKB-per-byte storage cost model: a 218 KB image requires roughly 218,000 CKB in capacity — far beyond the 10,000 CKB available. This is not a bug, but a correct enforcement of CKB's economic design. Resolved by using a much smaller image (7,444 bytes), successfully minted for a modest, appropriate capacity cost.

### Successful Testnet Result
- **Transaction hash:** `0x6c5e2bd70e96a1b04372ecef23de02c77d56dc5d1d56f3642529376f5089b5f6`
- Correctly rendered `contentType`: `image/png` (see Section 5, Bug 1)
- Image successfully rendered in-browser directly from public testnet data

## 5. Bugs Found, Explained, and Addressed

### Fixed
- **Bug 1 — Hardcoded Content Type:** `lib.ts` unconditionally set `contentType: "image/jpeg"` regardless of the actual uploaded file's type. Since Spore Cell data is immutable once minted, this meant every non-JPEG image (PNG, GIF, WebP, etc.) would be permanently, incorrectly labeled on-chain forever. **Fix:** `contentType` is now derived from the real uploaded file's MIME type (`selectedFile.type`), with a safe fallback to `application/octet-stream` if browser detection fails. Verified via a fresh on-chain transaction correctly showing `contentType: image/png`.

### Identified, Documented (Not Fixed — Scope/Risk Tradeoff)
- **Bug 2 — Two Competing SDKs in One Codebase:** `helper.ts` uses `@ckb-lumos/lumos` for wallet/signing logic, while the rest of the app (`ccc-client.ts`, `index.tsx`) uses `@ckb-ccc/core`. Two separate CKB SDKs increase bundle size and cognitive overhead for maintainers. *Proposed solution:* migrate `helper.ts`'s wallet logic to `@ckb-ccc/core` for internal consistency.
- **Bug 3 — Silent Data Corruption on Odd-Length Hex Input:** `hexStringToUint8Array()` in `helper.ts` divides string length by two without validating evenness, silently truncating malformed input rather than raising an error. Not triggered in current usage (image data is always even-length), but a latent correctness issue. *Proposed solution:* add an explicit length-parity guard that throws a clear error.
- **Bugs 4 & 5 — Conflicting Silent Network Defaults:** `ccc-client.ts`'s `readEnvNetwork()` silently defaults to `"testnet"` for any missing/invalid `NETWORK` value. `spore-config.ts` only explicitly branches on `"testnet"`, silently falling back to hardcoded Devnet configuration for any other value — including a genuinely intended `"mainnet"`. These two silent defaults disagree with each other, risking a state where the RPC client and the contract script addresses target different networks simultaneously. *Proposed solution:* centralize network resolution in one place, and throw a loud, explicit error for invalid/missing values rather than silently defaulting.
- **Bug 6 — Undeclared Transitive Dependency:** `@ckb-lumos/lumos` is imported directly in `helper.ts` but never declared in `package.json`. It currently functions only because `@spore-sdk/core` happens to depend on it internally. A future update to `@spore-sdk/core` could silently break this project with no clear diagnostic. *Proposed solution:* either explicitly declare the dependency, or resolve Bug 2 to remove the need for it entirely.
- **Bug 7 — Type-Safety Workaround (Minor):** `new Blob([buffer as unknown as BlobPart], ...)` uses a double type-cast to bypass a TypeScript error, functionally correct but disabling type-checking on that expression. *Proposed solution:* pass `buffer.buffer` (the underlying `ArrayBuffer`) instead, which typically satisfies `BlobPart`'s type definition without any cast.

## 6. Summary

| Deliverable | Status |
| --- | --- |
| On-chain digital object with image, via Spore-SDK | ✅ Confirmed on Devnet and Testnet |
| Image rendered in-browser from the digital object | ✅ Confirmed on both networks |
| App deployed to testnet | ✅ Real transaction, real public network, independently verified via block explorer |
| Content-type bug identified and fixed | ✅ Fixed, tested, verified on-chain |
| Additional bugs identified and documented | ✅ 6 further findings, each with a proposed solution |
| Real debugging encountered and resolved | ✅ Diagnosed and resolved a genuine capacity/storage-cost error on testnet |

## 7. Reflection Note

This project reinforced a central architectural difference between DOBs and typical NFTs: CKB's design forces the actual economic cost of on-chain data storage to be confronted directly, rather than abstracted away behind an off-chain link. The capacity error encountered mid-project was not an obstacle to route around — it was the protocol correctly enforcing its own economic model, and understanding why it happened was itself a meaningful part of learning how CKB fundamentally differs from account-based, storage-abstracted chains.
