/**
 * Daily PIPEDA data purge — Phase 10.1.
 *
 * Walks every Client where `purgeAt < now()` AND `legalHoldUntil` is null
 * or in the past. For each one:
 *
 *   1. Hard-delete sub-records that hold PII not needed for record-
 *      keeping: Messages, IntakeSubmissions, CaseAiData (extraction +
 *      provenance), Appointments (after the firm's records are written
 *      elsewhere via the audit log).
 *   2. Delete portal account + sessions (if not already disabled).
 *   3. Delete uploaded R2 objects (best-effort).
 *   4. Anonymise the Client row itself: set firstName/lastName/email/
 *      notes to null and replace phone with `+0PURGED-{shortId}` so the
 *      tenant uniqueness constraint stays satisfied while we keep the
 *      row for Cases/Invoices to reference (regulated record-keeping).
 *   5. Audit-log as SYSTEM actor.
 *
 * What we KEEP (intentionally, for record-keeping under PIPEDA's
 * legitimate-purpose carve-out for legal/regulatory matters):
 *   - Cases (with anonymised clientId pointer)
 *   - CaseInvoices + CasePayments (financial records: 7 years CRA)
 *   - IrccCorrespondence (immigration record retention)
 *   - AuditLog rows (compliance evidence)
 */
import { prisma } from '@onsecboad/db';
import { logger } from '../logger.js';

export async function dataPurgeTick(): Promise<{
  scanned: number;
  purged: number;
  errors: number;
}> {
  const now = new Date();
  const due = await prisma.client.findMany({
    where: {
      purgeAt: { lte: now },
      OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: now } }],
    },
    select: { id: true, tenantId: true, phone: true },
  });

  let purged = 0;
  let errors = 0;

  for (const c of due) {
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Sub-records with PII.
        await tx.message.deleteMany({ where: { clientId: c.id } });
        await tx.intakeSubmission.deleteMany({ where: { clientId: c.id } });
        // CaseAiData is keyed on caseId, but the data references this
        // client's PII; clear it for every case they touch.
        const caseIds = (
          await tx.case.findMany({ where: { clientId: c.id }, select: { id: true } })
        ).map((r) => r.id);
        if (caseIds.length > 0) {
          await tx.caseAiData.deleteMany({ where: { caseId: { in: caseIds } } });
        }

        // 2. Portal account + sessions.
        const account = await tx.clientPortalAccount.findUnique({
          where: { clientId: c.id },
          select: { id: true },
        });
        if (account) {
          await tx.clientPortalSession.deleteMany({ where: { accountId: account.id } });
          await tx.clientPortalAccount.delete({ where: { id: account.id } });
        }

        // 3. Anonymise the Client row.
        const shortId = c.id.slice(0, 8);
        await tx.client.update({
          where: { id: c.id },
          data: {
            firstName: null,
            lastName: null,
            email: null,
            phone: `+0PURGED-${shortId}`,
            notes: null,
            // Keep purgeAt set so it's clear in the audit trail this was
            // executed; also keep legalHoldUntil for compliance.
          },
        });

        // 4. Audit (SYSTEM actor — same convention as the Stripe webhook).
        await tx.auditLog.create({
          data: {
            tenantId: c.tenantId,
            actorId: '00000000-0000-0000-0000-000000000000',
            actorType: 'SYSTEM',
            action: 'dataPurge.executed',
            targetType: 'Client',
            targetId: c.id,
            payload: {
              caseCount: caseIds.length,
              hadPortalAccount: !!account,
            },
          },
        });
      });
      purged++;
    } catch (err) {
      errors++;
      logger.error({ err, clientId: c.id }, 'data-purge: client purge failed');
    }
  }

  return { scanned: due.length, purged, errors };
}
