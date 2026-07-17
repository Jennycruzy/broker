import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const MESSAGE_TRANSMITTER = new PublicKey("CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
const TOKEN_MESSENGER_MINTER = new PublicKey("CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
const SOLANA_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const INJECTIVE_USDC = "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
const RESERVE = new PublicKey("EgwE41BznuyVGtboQb5uBHsPdbabBzjzhyWYr3VRYC5J");
const burnHash = process.env.GATE2_BURN_HASH;
if (!/^0x[0-9a-fA-F]{64}$/.test(burnHash ?? "")) throw new Error("GATE2_BURN_HASH is required");

const response = await fetch(`https://iris-api-sandbox.circle.com/v2/messages/29?transactionHash=${burnHash}`);
if (!response.ok) throw new Error(`Circle attestation API returned HTTP ${response.status}`);
const attestationResponse = await response.json();
const record = attestationResponse.messages?.[0];
if (record?.status !== "complete" || !record.message || !record.attestation) {
  throw new Error(`Circle attestation is not complete: ${record?.status ?? "missing"}`);
}

const secret = JSON.parse(await readFile(".secrets/gate2-solana.json", "utf8"));
const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const CIRCLE_SAMPLE_COMMIT = "84f8a717a3a6164f12586804d96c3fac2f5432e7";
async function fetchPinnedIdl(name, expectedSha256) {
  const url = `https://raw.githubusercontent.com/circlefin/circle-cctp-crosschain-transfer/${CIRCLE_SAMPLE_COMMIT}/src/solana/idl/${name}.json`;
  const idlResponse = await fetch(url);
  if (!idlResponse.ok) throw new Error(`Circle IDL request failed with HTTP ${idlResponse.status}`);
  const bytes = Buffer.from(await idlResponse.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) throw new Error(`Circle ${name} IDL hash mismatch`);
  return JSON.parse(bytes.toString("utf8"));
}
const messageIdl = await fetchPinnedIdl("message_transmitter", "52f1c03b685f425cf9b76b5da11422eaec2bfa0b1823ae3c392cd639ca79e8e1");
const tokenIdl = await fetchPinnedIdl("token_messenger_minter", "434730e96df8fb3b3d9ab51b99db48d4f15ceba42cca8b3ff45de5a595b9f40d");
const messageProgram = new Program(messageIdl, provider);
const tokenProgram = new Program(tokenIdl, provider);

const find = (label, programId, extra = []) => PublicKey.findProgramAddressSync([
  Buffer.from(label),
  ...extra.map((seed) => typeof seed === "string" ? Buffer.from(seed) : seed.toBuffer ? seed.toBuffer() : seed),
], programId)[0];

const messageBytes = Buffer.from(record.message.slice(2), "hex");
const nonce = messageBytes.subarray(12, 44);
const sourceDomain = messageBytes.readUInt32BE(4);
if (sourceDomain !== 29) throw new Error(`attestation source domain is ${sourceDomain}, expected 29`);
const remoteTokenKey = new PublicKey(Buffer.from(`000000000000000000000000${INJECTIVE_USDC.slice(2)}`, "hex"));

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

const remainingAccounts = [
  { isSigner: false, isWritable: false, pubkey: tokenMessenger },
  { isSigner: false, isWritable: false, pubkey: remoteTokenMessenger },
  { isSigner: false, isWritable: true, pubkey: tokenMinter },
  { isSigner: false, isWritable: true, pubkey: localToken },
  { isSigner: false, isWritable: false, pubkey: tokenPair },
  { isSigner: false, isWritable: true, pubkey: feeRecipient },
  { isSigner: false, isWritable: true, pubkey: RESERVE },
  { isSigner: false, isWritable: true, pubkey: custody },
  { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  { isSigner: false, isWritable: false, pubkey: tokenEventAuthority },
  { isSigner: false, isWritable: false, pubkey: TOKEN_MESSENGER_MINTER },
];

const signature = await messageProgram.methods.receiveMessage({
  message: messageBytes,
  attestation: Buffer.from(record.attestation.slice(2), "hex"),
}).accounts({
  payer: payer.publicKey,
  caller: payer.publicKey,
  authorityPda: authority,
  messageTransmitter,
  usedNonce,
  receiver: TOKEN_MESSENGER_MINTER,
  systemProgram: SystemProgram.programId,
  eventAuthority: messageEventAuthority,
  program: MESSAGE_TRANSMITTER,
}).remainingAccounts(remainingAccounts).rpc();

const balance = await connection.getTokenAccountBalance(RESERVE, "confirmed");
console.log(JSON.stringify({
  burn_transaction: burnHash,
  attestation_status: record.status,
  message_hash_reference: record.cctpVersion ?? null,
  mint_transaction: signature,
  reserve: RESERVE.toBase58(),
  reserve_amount: balance.value.amount,
  explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
}, null, 2));
