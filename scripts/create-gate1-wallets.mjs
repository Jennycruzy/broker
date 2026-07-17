import { mkdir, open } from "node:fs/promises";
import { bech32 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";
import { generatePrivateKey } from "viem/accounts";

await mkdir(".secrets", { recursive: true, mode: 0o700 });

for (const role of ["facilitator", "payer"]) {
  const key = generatePrivateKey();
  const path = `.secrets/gate1-${role}.key`;
  const file = await open(path, "wx", 0o600);
  await file.writeFile(`${key}\n`, { encoding: "utf8" });
  await file.close();
  const account = privateKeyToAccount(key);
  const addressBytes = Uint8Array.from(Buffer.from(account.address.slice(2), "hex"));
  const injectiveAddress = bech32.encode("inj", bech32.toWords(addressBytes));
  console.log(`${role}: ${account.address} (${injectiveAddress})`);
}
