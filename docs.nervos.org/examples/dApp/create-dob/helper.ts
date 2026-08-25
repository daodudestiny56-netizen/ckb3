import { ccc, Script } from "@ckb-ccc/core";
import { cccClient } from "./ccc-client";

/**
 * CKB Wallet interface powered strictly by @ckb-ccc/core SDK.
 * Eliminates all Lumos imports to ensure a single, consistent SDK throughout the dApp.
 */
export interface Wallet {
  lock: Script;
  address: string;
  signer: ccc.SignerCkbPrivateKey;
  signAndSendTransaction(txSkeleton: any): Promise<string>;
}

/**
 * Creates a Secp256k1 Blake160 Wallet from a private key using @ckb-ccc/core.
 */
export async function createDefaultLockWallet(privateKey: string): Promise<Wallet> {
  // Ensure 0x prefix for private key
  const formattedPrivateKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const signer = new ccc.SignerCkbPrivateKey(cccClient, formattedPrivateKey);

  // Address script calculation via CCC
  const addressObj = await signer.getAddressObjSecp256k1();
  const lock = addressObj.script;
  const address = addressObj.toString();

  async function signAndSendTransaction(txSkeleton: any): Promise<string> {
    // Spore SDK builds a Lumos-compatible txSkeleton.
    // Convert it to a CCC Transaction object for signing and RPC submission via CCC.
    const tx = ccc.Transaction.fromLumosSkeleton(txSkeleton);
    return await signer.sendTransaction(tx);
  }

  return {
    lock,
    address,
    signer,
    signAndSendTransaction,
  };
}

/**
 * Convert a hexadecimal string to Uint8Array.
 * Fixes Bug 3: Validates even length parity to prevent silent data corruption.
 */
export function hexStringToUint8Array(hexString: string): Uint8Array {
  let cleanHex = hexString.startsWith("0x") ? hexString.slice(2) : hexString;
  
  if (cleanHex.length % 2 !== 0) {
    throw new Error(
      `Invalid hex string: length must be even, but got ${cleanHex.length} characters ("${cleanHex}").`
    );
  }

  const len = cleanHex.length;
  const buffer = new Uint8Array(len / 2);

  for (let i = 0; i < len; i += 2) {
    const byte = parseInt(cleanHex.substr(i, 2), 16);
    if (isNaN(byte)) {
      throw new Error(`Invalid hex character in string at index ${i}`);
    }
    buffer[i / 2] = byte;
  }

  return buffer;
}

/**
 * Generates a cryptographically secure 32-byte private key in hex format.
 */
export function generateRandomPrivateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
