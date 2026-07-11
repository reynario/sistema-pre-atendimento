import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Fila única de jobs com tipos distintos. jobId determinístico permite
// substituir jobs pendentes (debounce de conversa, follow-up por contato).
export type JobData =
  | { kind: "process-conversation"; tenantId: string; conversationId: string }
  | { kind: "send-reminder"; tenantId: string; reminderId: string }
  | { kind: "send-followup"; tenantId: string; followUpId: string }
  | { kind: "check-whatsapp" }
  | { kind: "send-postvisit"; tenantId: string; appointmentId: string }
  | { kind: "process-waitlist"; tenantId: string; appointmentId: string };

export const jobsQueue = new Queue<JobData, unknown, string>("alo-jobs", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 500,
    removeOnFail: 500,
  },
});

/**
 * Agenda (ou reagenda) um job com jobId determinístico: se já existir um
 * pendente com o mesmo id, ele é removido e substituído — é assim que o
 * debounce de mensagens picadas e o follow-up único por contato funcionam.
 */
export async function scheduleReplaceable(jobId: string, data: JobData, delayMs: number) {
  const existing = await jobsQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState().catch(() => null);
    if (state === "delayed" || state === "waiting") {
      await existing.remove().catch(() => {});
    }
  }
  await jobsQueue.add(data.kind, data, { jobId, delay: delayMs });
}

export async function cancelJob(jobId: string) {
  const existing = await jobsQueue.getJob(jobId);
  if (existing) await existing.remove().catch(() => {});
}
