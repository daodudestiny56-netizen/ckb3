import { setSporeConfig, createSpore, unpackToRawSporeData } from "@spore-sdk/core";
import { SPORE_CONFIG } from "./spore-config";
import { createDefaultLockWallet, hexStringToUint8Array } from "./helper";
import { ccc, Script } from "@ckb-ccc/core";
import { cccClient, readEnvNetwork } from "./ccc-client";

// Initialize Spore SDK configuration
setSporeConfig(SPORE_CONFIG);

export type Account = {
  lockScript: Script;
  address: string;
  pubKey: string;
};

export interface DOBItem {
  sporeId: string;
  txHash: string;
  outputIndex: number;
  contentType: string;
  content: Uint8Array;
  contentHex: string;
  capacityShannons: bigint;
  capacityCKB: string;
  dataUrl: string;
}

export const generateAccountFromPrivateKey = async (
  privKey: string
): Promise<Account> => {
  const wallet = await createDefaultLockWallet(privKey);
  return {
    lockScript: wallet.lock,
    address: wallet.address,
    pubKey: wallet.signer.publicKey || "",
  };
};

export async function capacityOf(address: string): Promise<bigint> {
  const addr = await ccc.Address.fromString(address, cccClient);
  const balance = await cccClient.getBalance([addr.script]);
  return balance;
}

export function shannonToCKB(amount: bigint): string {
  const ckb = Number(amount) / 100000000;
  return ckb.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}

/**
 * Pre-mint CKB capacity storage cost estimation.
 * On CKB, storage is economically backed: 1 Byte of state storage requires 1 CKB (100,000,000 Shannons).
 * A Spore Cell includes lock script (~53B), Spore type script (~65B), capacity field (8B),
 * Spore header metadata (~30B), plus the raw file content bytes.
 */
export function estimateDOBCost(fileSizeBytes: number) {
  const baseOverheadBytes = 160;
  const totalBytesNeeded = baseOverheadBytes + fileSizeBytes;
  const minRequiredCKB = BigInt(totalBytesNeeded);
  // Add 1 CKB buffer for mining transaction fees
  const recommendedCKB = minRequiredCKB + 1n;
  
  return {
    fileSizeBytes,
    baseOverheadBytes,
    recommendedCKB: recommendedCKB.toString(),
    recommendedShannons: recommendedCKB * 100000000n,
  };
}

/**
 * Creates an on-chain DOB (Spore Cell) using @spore-sdk/core and @ckb-ccc/core.
 * Content type is dynamically derived from the uploaded file (never hardcoded).
 */
export async function createSporeDOB(
  privkey: string,
  content: Uint8Array,
  contentType: string
): Promise<{ txHash: string; outputIndex: number }> {
  // Safe MIME type fallback if browser fails to detect file type
  const safeContentType = contentType.trim() !== "" ? contentType : "application/octet-stream";
  
  const wallet = await createDefaultLockWallet(privkey);

  const { txSkeleton, outputIndex } = await createSpore({
    data: {
      contentType: safeContentType,
      content,
    },
    toLock: wallet.lock,
    fromInfos: [wallet.address],
    config: SPORE_CONFIG,
  });

  const txHash = await wallet.signAndSendTransaction(txSkeleton);
  console.log(`Spore Created! Transaction Hash: ${txHash}`);
  
  return { txHash, outputIndex };
}

/**
 * Fetch and decode all DOB Spore Cells owned by a target wallet address on-chain.
 */
export async function fetchWalletDOBs(address: string): Promise<DOBItem[]> {
  try {
    const addr = await ccc.Address.fromString(address, cccClient);
    const dobs: DOBItem[] = [];

    // Query on-chain live cells for the user's lock script
    for await (const cell of cccClient.findCells({ script: addr.script, scriptType: "lock", scriptSearchMode: "exact" })) {
      // Check if cell has a type script attached (Spore Cell requirement)
      if (!cell.cellOutput.type) continue;

      try {
        // Unpack raw Spore Cell data
        const sporeData = unpackToRawSporeData(cell.outputData);
        if (!sporeData || !sporeData.contentType) continue;

        const rawContentHex = sporeData.content.toString();
        const contentBytes = hexStringToUint8Array(rawContentHex);

        // Build data URL for rendering in browser
        // Double cast as unknown as BlobPart to bypass TS 5.7+ Uint8Array ArrayBufferLike issue
        const blob = new Blob([contentBytes as unknown as BlobPart], { type: sporeData.contentType });
        const dataUrl = URL.createObjectURL(blob);

        const capShannons = cell.cellOutput.capacity;
        const capCKB = (Number(capShannons) / 100000000).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4,
        });

        dobs.push({
          sporeId: cell.cellOutput.type.args || "N/A",
          txHash: cell.outPoint.txHash,
          outputIndex: Number(cell.outPoint.index),
          contentType: sporeData.contentType,
          content: contentBytes,
          contentHex: rawContentHex,
          capacityShannons: capShannons,
          capacityCKB: capCKB,
          dataUrl,
        });
      } catch (unpackErr) {
        // Not a Spore cell or corrupted spore cell data, safely skip
        continue;
      }
    }

    return dobs;
  } catch (err) {
    console.error("Error fetching DOBs from blockchain:", err);
    throw err;
  }
}

/**
 * Inspect a specific Spore Cell content by transaction hash and index.
 */
export async function showSporeContent(txHash: string, index = 0) {
  const indexHex = "0x" + index.toString(16);
  const cell = await cccClient.getCellLive({ txHash, index: indexHex }, true);
  if (cell == null) {
    throw new Error("Spore cell not found on-chain. Please verify the transaction hash.");
  }
  const sporeData = unpackToRawSporeData(cell.outputData);
  return sporeData;
}
