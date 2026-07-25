import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const TERMINAL = new Set(["policy_bound", "failed"]);
const clone = (value) => JSON.parse(JSON.stringify(value));

export function bindJobId(paymentReceipt) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(paymentReceipt.payment_transaction ?? "")) {
    throw new Error("bind orchestration requires a valid payment transaction hash");
  }
  return createHash("sha256")
    .update(`${paymentReceipt.network}:${paymentReceipt.payment_transaction.toLowerCase()}`)
    .digest("hex");
}

export function createBindOrchestrator({ directory, bridgePremium, issuePolicy, now = () => new Date() }) {
  if (!directory || !bridgePremium || !issuePolicy) {
    throw new Error("bind orchestrator requires directory, bridgePremium, and issuePolicy");
  }
  const running = new Map();
  const fileFor = (id) => path.join(directory, `${id}.json`);

  async function load(id) {
    try {
      return JSON.parse(await readFile(fileFor(id), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async function save(job) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const target = fileFor(job.id);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
    return clone(job);
  }

  async function transition(job, status, extra = {}) {
    return save({ ...job, ...extra, status, updated_at: now().toISOString() });
  }

  async function run(id) {
    let job = await load(id);
    if (!job || TERMINAL.has(job.status)) return job;
    try {
      if (!job.bridge) {
        job = await transition(job, "bridging");
        const bridge = await bridgePremium(clone(job.payment_receipt));
        job = await transition(job, "bridge_complete", { bridge });
      }
      if (!job.policy) {
        job = await transition(job, "issuing_policy");
        const policy = await issuePolicy(clone(job.payment_receipt), clone(job.bridge));
        job = await transition(job, "policy_bound", { policy });
      }
      return job;
    } catch (error) {
      return transition(job, "failed", {
        error: { message: error.message, retryable: error.retryable === true },
      });
    } finally {
      running.delete(id);
    }
  }

  return {
    async enqueue(paymentReceipt) {
      const id = bindJobId(paymentReceipt);
      let job = await load(id);
      if (!job) {
        const timestamp = now().toISOString();
        job = await save({
          id,
          status: "payment_settled",
          payment_receipt: clone(paymentReceipt),
          created_at: timestamp,
          updated_at: timestamp,
        });
      } else if (
        job.payment_receipt.payment_transaction.toLowerCase()
          !== paymentReceipt.payment_transaction.toLowerCase()
      ) {
        throw new Error(`bind job ${id} payment identity mismatch`);
      }
      if (!TERMINAL.has(job.status) && !running.has(id)) {
        const promise = run(id);
        running.set(id, promise);
      }
      return clone(job);
    },

    async status(id) {
      return clone(await load(id));
    },

    async wait(id) {
      if (running.has(id)) await running.get(id);
      return clone(await load(id));
    },
  };
}
