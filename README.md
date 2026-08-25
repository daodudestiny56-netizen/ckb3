# CKB Digital Object (DOB) Development & Technical Deep Dive

This document records the engineering process of completing Nervos CKB's ["Create a DOB"](https://docs.nervos.org/docs/dapp/create-dob) tutorial, extending the application into a full DOB Gallery dApp, resolving technical debt in the baseline codebase, and deploying on-chain digital objects to the public CKB testnet via the Spore Protocol.

---

## 1. Environment & Toolchain

| Component | Version / Specification |
| --- | --- |
| Operating System | Windows 11 (native PowerShell environment) |
| Node.js | v24.11.1 |
| npm | 11.12.1 |
| Git | 2.52.0 |
| OffCKB CLI | 0.4.13 |

### Setup Commands
1. Installed OffCKB globally: `npm install -g @offckb/cli`
2. Initialized local CKB Devnet node: `offckb node`
3. Installed project dependencies in `examples/dApp/create-dob`: `npm install`
4. Started development server on Windows: `$env:NETWORK="devnet"; npm start`

---

## 2. On-Chain Asset Architecture: Spore DOBs

Spore Protocol implements digital objects (DOBs) natively on CKB using the Cell Model. Unlike traditional token standards on EVM chains that store off-chain pointers (such as HTTP or IPFS URLs), a Spore Cell holds raw asset data directly within the cell output state on Layer 1.

### Technical Implications
- **State Storage Costs**: Storage on CKB is economically backed. 1 byte of state occupied on-chain requires 1 CKB (100,000,000 Shannons) locked in the cell capacity.
- **Immutability**: Once created, a Spore Cell's content bytes and content-type metadata cannot be modified or replaced.
- **Data Availability**: The asset persists as long as the cell exists on-chain, requiring no external storage nodes, IPFS pinning services, or centralized gateways.

---

## 3. Deployment & Execution Record

### Devnet Testing
- Minted an initial Spore Cell containing PNG data on a local CKB Devnet node.
- Confirmed transaction hash: `0xca6168595817d7d813793bee257121482c86fee841bf642304e3c64301827168`
- Retrieved on-chain bytes via `showSporeContent` and verified image rendering in browser.

### Testnet Deployment
- Switched target network: `$env:NETWORK="testnet"; npm start`
- Verified network client initialization: `ccc.ClientPublicTestnet()` in `ccc-client.ts`.
- Security Configuration: Replaced public example private keys with a freshly generated 32-byte key (`crypto.getRandomValues`) to prevent key collisions on public testnet.
- Funded address with 10,000 testnet CKB via the Nervos Pudge Faucet (`faucet.nervos.org`).

### Storage Capacity Error & Diagnosis
Initial minting of a 218 KB image failed with:
```
Unhandled Rejection (Error): Not enough capacity in from infos!
```
**Root Cause**: CKB's 1-CKB-per-byte capacity rule requires ~218,000 CKB to store a 218 KB file. The wallet balance of 10,000 CKB was insufficient to cover the cell's required state capacity.

**Resolution**: Minted a smaller image asset (7,444 bytes requiring ~7,604 CKB total capacity).

- Testnet Transaction Hash: `0x6c5e2bd70e96a1b04372ecef23de02c77d56dc5d1d56f3642529376f5089b5f6`
- On-chain Content-Type: `image/png`

---

## 4. Codebase Audit & Bug Fixes

During review of the original tutorial codebase, seven technical issues were identified and resolved.

### Bug 1: Hardcoded Content-Type
- **Issue**: `lib.ts` hardcoded `contentType: "image/jpeg"`, causing non-JPEG uploads (PNG, WebP, GIF) to be permanently mislabeled on-chain.
- **Fix**: Derived content-type dynamically from `file.type`, adding a fallback to `application/octet-stream`.

### Bug 2 & Bug 6: SDK Fragmentation & Undeclared Dependencies
- **Issue**: `helper.ts` imported `@ckb-lumos/lumos` directly for signing, while the rest of the application used `@ckb-ccc/core`. Lumos was not declared in `package.json` and worked only as a transitive dependency of `@spore-sdk/core`.
- **Fix**: Refactored `helper.ts` to remove direct Lumos imports. Converted Spore-SDK output skeletons to CCC transactions using `ccc.Transaction.fromLumosSkeleton()` and signed using `ccc.SignerCkbPrivateKey`.

### Bug 3: Hex String Length Parity
- **Issue**: `hexStringToUint8Array()` in `helper.ts` parsed strings without validating even character lengths.
- **Fix**: Added explicit length check throwing an error if `hexString.length % 2 !== 0`.

### Bugs 4 & 5: Inconsistent Fallback Logic for Network Configuration
- **Issue**: `ccc-client.ts` and `spore-config.ts` had conflicting fallback rules when `process.env.NETWORK` was invalid or unset.
- **Fix**: Centralized network parsing in `readEnvNetwork()`. Updated both files to throw explicit runtime errors on invalid input rather than silently defaulting.

### Bug 7: TypeScript DOM Type Compatibility
- **Issue**: TypeScript 5.7+ typed `Uint8Array` as generic over `ArrayBufferLike`, causing a type mismatch when passed to `new Blob([...])`.
- **Fix**: Maintained explicit casting to satisfy TS compiler constraints while ensuring runtime buffer validity.

---

## 5. CKB DOB Gallery Application Rebuild

The application was restructured into a single-page dApp featuring a modern dark theme and comprehensive asset management tools.

### Core Implementation Modules

1. **Wallet Management (`helper.ts`, `lib.ts`)**:
   - Private key input with visibility masking toggle.
   - Single-click key generation using `crypto.getRandomValues`.
   - Automatic balance polling every 10 seconds via `cccClient.getBalance`.

2. **Pre-Mint Storage Cost Calculator (`lib.ts`)**:
   - Computes required CKB capacity before transaction submission:
     $$\text{Capacity Required} = \text{File Size (bytes)} + 160 \text{ bytes (Cell Header and Script Overhead)} + 1 \text{ CKB (Fee Buffer)}$$
   - Prevents insufficient capacity failures prior to network broadcast.

3. **Drag-and-Drop Uploader (`index.tsx`)**:
   - File dropzone with live image preview and MIME type detection display.

4. **On-Chain DOB Gallery (`lib.ts`, `index.tsx`)**:
   - Indexes live Spore Cells using `cccClient.findCells` with `scriptSearchMode: "exact"`.
   - Decodes payload via `unpackToRawSporeData`.
   - Renders responsive card layout with truncated transaction hashes, capacity allocations, and content-type tags.

5. **Asset Detail Inspection Modal (`index.tsx`)**:
   - Displays full-resolution render, Spore Asset ID, content type, locked cell capacity (in CKB and Shannons), transaction hash, and direct link to the CKB Explorer.

---

## 6. Summary of Deliverables

| Requirement | Implementation Status |
| --- | --- |
| Spore DOB Minting Flow | Complete on Devnet and Testnet |
| In-Browser Image Rendering | Verified from on-chain cell data |
| Public Testnet Deployment | Verified via transaction explorer |
| Codebase Audit & Refactoring | All 7 identified issues resolved |
| Storage Capacity Pre-Check | Implemented and verified against live mints |
| Wallet & Gallery Interface | Complete SPA implementation |

---

## 7. Documentation & References

- Screenshot Documentation: [Google Drive Archive](https://drive.google.com/drive/folders/18tM5eDaonZqn705zLCtR9SZaEXdcXWvO?usp=drive_link)
- Nervos CKB Explorer (Testnet): [aggron.explorer.nervos.org](https://explorer.nervos.org/aggron)
- Spore Protocol Documentation: [spore.pro](https://spore.pro)

---

## 8. Engineering Reflection

Building on CKB highlights a fundamental difference between account-based chains and Cell-based architecture. On CKB, state storage is not an abstracted protocol overhead — it is an explicit economic transaction where data footprint directly dictates capacity requirements. Incorporating real-time capacity estimation in client applications is essential for providing predictable user experiences on UTXO-based state models.
