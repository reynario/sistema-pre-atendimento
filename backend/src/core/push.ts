import webpush from "web-push";
import { prisma } from "../db.js";
import { env } from "../env.js";

const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
if (enabled) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
}

export const pushEnabled = enabled;

/**
 * Envia web push para todos os aparelhos cadastrados da clínica.
 * Assinaturas mortas (410/404) são removidas automaticamente.
 */
export async function sendPushToTenant(tenantId: string, title: string, body: string) {
  if (!enabled) return;
  const subs = await prisma.pushSubscription.findMany({ where: { tenantId } });
  const payload = JSON.stringify({ title, body, url: "/" });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
      }
    }),
  );
}
