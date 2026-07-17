import { readFile } from "node:fs/promises";
import { PublicKey } from "@solana/web3.js";
import { createPublicClient, createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { injectiveTestnet } from "viem/chains";

const USDC = "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d";
const TOKEN_MESSENGER = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const RESERVE = new PublicKey("EgwE41BznuyVGtboQb5uBHsPdbabBzjzhyWYr3VRYC5J");
const amount = BigInt(process.env.GATE2_CCTP_AMOUNT ?? "");
if (amount < 1n) throw new Error("GATE2_CCTP_AMOUNT must be a positive USDC base-unit integer");

const key = (await readFile(".secrets/gate1-facilitator.key", "utf8")).trim();
const account = privateKeyToAccount(key);
const rpcUrl = "https://k8s.testnet.json-rpc.injective.network/";
const publicClient = createPublicClient({ chain: injectiveTestnet, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain: injectiveTestnet, transport: http(rpcUrl) });

const erc20Abi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];
const burnAbi = [{
  type: "function",
  name: "depositForBurn",
  stateMutability: "nonpayable",
  inputs: [
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "mintRecipient", type: "bytes32" },
    { name: "burnToken", type: "address" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32" },
  ],
  outputs: [],
}];

const approveHash = await walletClient.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "approve",
  args: [TOKEN_MESSENGER, amount],
});

for (let attempt = 0; attempt < 30; attempt += 1) {
  const allowance = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, TOKEN_MESSENGER],
  });
  if (allowance === amount) break;
  if (attempt === 29) throw new Error(`approval ${approveHash} did not become visible`);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

const mintRecipient = `0x${Buffer.from(RESERVE.toBytes()).toString("hex")}`;
const burnData = encodeFunctionData({
  abi: burnAbi,
  functionName: "depositForBurn",
  args: [amount, 5, mintRecipient, USDC, `0x${"00".repeat(32)}`, 0n, 2_000],
});
const burnHash = await walletClient.sendTransaction({
  account,
  chain: injectiveTestnet,
  to: TOKEN_MESSENGER,
  data: burnData,
});

console.log(JSON.stringify({
  amount: amount.toString(),
  source_domain: 29,
  destination_domain: 5,
  mint_recipient: RESERVE.toBase58(),
  approval_transaction: approveHash,
  burn_transaction: burnHash,
  burn_explorer: `https://testnet.blockscout.injective.network/tx/${burnHash}`,
  attestation_url: `https://iris-api-sandbox.circle.com/v2/messages/29?transactionHash=${burnHash}`,
}, null, 2));
