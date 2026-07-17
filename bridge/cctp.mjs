// BROKER CCTP bridge — burn USDC on Injective testnet, mint native USDC on
// Solana devnet, to an arbitrary recipient token account. Generalized from the
// proven Gate 2 burn/mint scripts (same Circle contracts, same pinned Circle
// IDLs verified by SHA-256). Real burn + real Circle attestation + real mint;
// no represented transfer.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { createPublicClient, createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { injectiveTestnet } from "viem/chains";

const INJ_USDC = "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
const INJ_TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const INJ_RPC = "https://k8s.testnet.json-rpc.injective.network/";
const MESSAGE_TRANSMITTER = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
const TOKEN_MESSENGER_MINTER = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
const SOLANA_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const CIRCLE_SAMPLE_COMMIT = "84f8a717a3a6164f12586804d96c3fac2f5432e7";

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];
const burnAbi = [{ type: "function", name: "depositForBurn", stateMutability: "nonpayable", inputs: [
  { name: "amount", type: "uint256" }, { name: "destinationDomain", type: "uint32" }, { name: "mintRecipient", type: "bytes32" },
  { name: "burnToken", type: "address" }, { name: "destinationCaller", type: "bytes32" }, { name: "maxFee", type: "uint256" }, { name: "minFinalityThreshold", type: "uint32" },
], outputs: [] }];

export function injectiveAccount(keyPath) {
  return readFile(keyPath, "utf8").then((k) => privateKeyToAccount(k.trim()));
}

// Burn `amount` USDC base units on Injective, destined for `mintRecipient`
// (a Solana token account) on Solana devnet (domain 5).
export async function burnFromInjective({ keyPath, amount, mintRecipient }) {
  const account = await injectiveAccount(keyPath);
  const publicClient = createPublicClient({ chain: injectiveTestnet, transport: http(INJ_RPC) });
  const walletClient = createWalletClient({ account, chain: injectiveTestnet, transport: http(INJ_RPC) });
  const value = BigInt(amount);

  const approveHash = await walletClient.writeContract({ address: INJ_USDC, abi: erc20Abi, functionName: "approve", args: [INJ_TOKEN_MESSENGER, value] });
  for (let attempt = 0; ; attempt += 1) {
    const allowance = await publicClient.readContract({ address: INJ_USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, INJ_TOKEN_MESSENGER] });
    if (allowance >= value) break;
    if (attempt === 29) throw new Error(`approval ${approveHash} did not become visible`);
    await new Promise((r) => setTimeout(r, 2_000));
  }

  const recipient = mintRecipient instanceof PublicKey ? mintRecipient : new PublicKey(mintRecipient);
  const mintRecipientHex = `0x${Buffer.from(recipient.toBytes()).toString("hex")}`;
  const burnData = encodeFunctionData({ abi: burnAbi, functionName: "depositForBurn", args: [value, 5, mintRecipientHex, INJ_USDC, `0x${"00".repeat(32)}`, 0n, 2_000] });
  const burnHash = await walletClient.sendTransaction({ account, chain: injectiveTestnet, to: INJ_TOKEN_MESSENGER, data: burnData });
  return { burnHash, mintRecipient: recipient.toBase58(), amount: value.toString(), approveHash };
}

async function fetchPinnedIdl(name, expectedSha256) {
  const url = `https://raw.githubusercontent.com/circlefin/circle-cctp-crosschain-transfer/${CIRCLE_SAMPLE_COMMIT}/src/solana/idl/${name}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Circle IDL request failed with HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) throw new Error(`Circle ${name} IDL hash mismatch`);
  return JSON.parse(bytes.toString("utf8"));
}

export async function waitForAttestation(burnHash, { timeoutMs = 180_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`https://iris-api-sandbox.circle.com/v2/messages/29?transactionHash=${burnHash}`);
    if (res.ok) {
      const record = (await res.json()).messages?.[0];
      if (record?.status === "complete" && record.message && record.attestation) return record;
    }
    if (Date.now() > deadline) throw new Error(`attestation for ${burnHash} not complete within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

// Mint the attested burn into `recipientTokenAccount` on Solana devnet.
export async function mintOnSolana({ record, recipientTokenAccount, solanaKeyPath, connection }) {
  const secret = JSON.parse(await readFile(solanaKeyPath, "utf8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  const conn = connection ?? new Connection("https://api.devnet.solana.com", "confirmed");
  const provider = new AnchorProvider(conn, new Wallet(payer), { commitment: "confirmed" });
  const messageIdl = await fetchPinnedIdl("message_transmitter", "52f1c03b685f425cf9b76b5da11422eaec2bfa0b1823ae3c392cd639ca79e8e1");
  const tokenIdl = await fetchPinnedIdl("token_messenger_minter", "434730e96df8fb3b3d9ab51b99db48d4f15ceba42cca8b3ff45de5a595b9f40d");
  const messageProgram = new Program(messageIdl, provider);
  const tokenProgram = new Program(tokenIdl, provider);

  const find = (label, programId, extra = []) => PublicKey.findProgramAddressSync([
    Buffer.from(label), ...extra.map((s) => (typeof s === "string" ? Buffer.from(s) : s.toBuffer ? s.toBuffer() : s)),
  ], programId)[0];

  const messageBytes = Buffer.from(record.message.slice(2), "hex");
  const nonce = messageBytes.subarray(12, 44);
  const sourceDomain = messageBytes.readUInt32BE(4);
  if (sourceDomain !== 29) throw new Error(`attestation source domain is ${sourceDomain}, expected 29`);
  const remoteTokenKey = new PublicKey(Buffer.from(`000000000000000000000000${INJ_USDC.slice(2)}`, "hex"));

  const tokenMessenger = find("token_messenger", TOKEN_MESSENGER_MINTER);
  const messageTransmitter = find("message_transmitter", MESSAGE_TRANSMITTER);
  const tokenMinter = find("token_minter", TOKEN_MESSENGER_MINTER);
  const localToken = find("local_token", TOKEN_MESSENGER_MINTER, [SOLANA_USDC]);
  const remoteTokenMessenger = find("remote_token_messenger", TOKEN_MESSENGER_MINTER, [sourceDomain.toString()]);
  const tokenPair = find("token_pair", TOKEN_MESSENGER_MINTER, [sourceDomain.toString(), remoteTokenKey]);
  const custody = find("custody", TOKEN_MESSENGER_MINTER, [SOLANA_USDC]);
  const authority = find("message_transmitter_authority", MESSAGE_TRANSMITTER, [TOKEN_MESSENGER_MINTER]);
  const tokenEventAuthority = find("__event_authority", TOKEN_MESSENGER_MINTER);
  const messageEventAuthority = find("__event_authority", MESSAGE_TRANSMITTER);
  const usedNonce = find("used_nonce", MESSAGE_TRANSMITTER, [nonce]);
  const tokenMessengerState = await tokenProgram.account.tokenMessenger.fetch(tokenMessenger);
  const feeRecipient = await getAssociatedTokenAddress(SOLANA_USDC, tokenMessengerState.feeRecipient);
  const recipient = recipientTokenAccount instanceof PublicKey ? recipientTokenAccount : new PublicKey(recipientTokenAccount);

  const remainingAccounts = [
    { isSigner: false, isWritable: false, pubkey: tokenMessenger },
    { isSigner: false, isWritable: false, pubkey: remoteTokenMessenger },
    { isSigner: false, isWritable: true, pubkey: tokenMinter },
    { isSigner: false, isWritable: true, pubkey: localToken },
    { isSigner: false, isWritable: false, pubkey: tokenPair },
    { isSigner: false, isWritable: true, pubkey: feeRecipient },
    { isSigner: false, isWritable: true, pubkey: recipient },
    { isSigner: false, isWritable: true, pubkey: custody },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: tokenEventAuthority },
    { isSigner: false, isWritable: false, pubkey: TOKEN_MESSENGER_MINTER },
  ];

  const signature = await messageProgram.methods.receiveMessage({
    message: messageBytes, attestation: Buffer.from(record.attestation.slice(2), "hex"),
  }).accounts({
    payer: payer.publicKey, caller: payer.publicKey, authorityPda: authority, messageTransmitter,
    usedNonce, receiver: TOKEN_MESSENGER_MINTER, systemProgram: SystemProgram.programId,
    eventAuthority: messageEventAuthority, program: MESSAGE_TRANSMITTER,
  }).remainingAccounts(remainingAccounts).rpc();
  return { mintSignature: signature, recipient: recipient.toBase58() };
}
