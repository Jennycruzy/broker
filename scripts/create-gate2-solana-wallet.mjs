import { mkdir, open } from "node:fs/promises";
import { Keypair } from "@solana/web3.js";

await mkdir(".secrets", { recursive: true, mode: 0o700 });
const keypair = Keypair.generate();
const path = ".secrets/gate2-solana.json";
const file = await open(path, "wx", 0o600);
await file.writeFile(`${JSON.stringify([...keypair.secretKey])}\n`, { encoding: "utf8" });
await file.close();
console.log(`gate2-solana: ${keypair.publicKey.toBase58()}`);
