import { createHmac } from 'node:crypto';
import { prisma } from '@/lib/db';

/**
 * Fire-and-forget webhook dispatch. Each delivery is signed with the
 * subscription's secret (X-Wave-Signature: sha256=<hmac of body>) so
 * receivers can verify authenticity. Failures are logged to the audit trail;
 * a retry queue is the production upgrade path.
 */
export async function dispatchWebhooks(businessId: string, event: string, payload: unknown): Promise<void> {
  const subs = await prisma.webhookSubscription.findMany({
    where: { businessId, isActive: true, events: { has: event } },
  });
  if (subs.length === 0) return;
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data: payload });

  await Promise.allSettled(
    subs.map(async (sub) => {
      const signature = createHmac('sha256', sub.secret).update(body).digest('hex');
      try {
        const res = await fetch(sub.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Wave-Signature': `sha256=${signature}` },
          body,
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        await prisma.auditLog.create({
          data: {
            businessId,
            action: 'webhook.delivery_failed',
            entityType: 'webhook_subscription',
            entityId: sub.id,
            payload: { event, error: e instanceof Error ? e.message : String(e) },
          },
        });
      }
    }),
  );
}
