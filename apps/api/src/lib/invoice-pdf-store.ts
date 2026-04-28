/**
 * Invoice PDF cache helpers — Phase 7.3.
 *
 * Lazy-renders an invoice PDF on demand and stashes the bytes in R2.
 * The CaseInvoice row carries the pdfR2Key + pdfRenderedAt as the cache;
 * mutations that change what the PDF should display call invalidate()
 * to clear the key (and best-effort delete the object) so the next
 * request re-renders.
 *
 * Triggered by:
 *   - caseInvoice.update (line items changed) → invalidate
 *   - caseInvoice.void → invalidate (status changed)
 *   - refreshInvoiceStatuses promotes to PAID → invalidate (PAID stamp)
 */
import type { PrismaClient, Prisma } from '@onsecboad/db';
import { uploadBuffer, signedUrl, deleteObject } from '@onsecboad/r2';
import { renderInvoicePdf, type InvoicePdfBranding } from './invoice-pdf.js';

type Tx = PrismaClient | Prisma.TransactionClient;

function r2KeyFor(tenantId: string, invoiceId: string): string {
  return `tenants/${tenantId}/case-invoices/${invoiceId}.pdf`;
}

/**
 * Drop the cached PDF (DB key + R2 object). Safe to call when nothing
 * is cached. Used on every mutation that changes what the PDF would
 * show: line edits, void, paid-status flip.
 */
export async function invalidateInvoicePdf(tx: Tx, invoiceId: string): Promise<void> {
  const inv = await tx.caseInvoice.findUnique({
    where: { id: invoiceId },
    select: { pdfR2Key: true },
  });
  if (!inv?.pdfR2Key) return;
  // Best-effort: even if deleteObject fails, clear the DB pointer so the
  // next request re-renders and re-uploads.
  try {
    await deleteObject(inv.pdfR2Key);
  } catch {
    /* swallow — Phase 5.3 docs already established this is best-effort */
  }
  await tx.caseInvoice.update({
    where: { id: invoiceId },
    data: { pdfR2Key: null, pdfRenderedAt: null },
  });
}

/**
 * Return a 1-hour signed URL for the invoice PDF, rendering + uploading
 * lazily on first request. Caller is responsible for scope-checking the
 * invoice before passing it in.
 */
export async function getInvoicePdfSignedUrl(
  prisma: PrismaClient,
  invoiceId: string,
): Promise<string> {
  const inv = await prisma.caseInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      payments: {
        where: { status: { not: 'VOIDED' } },
        select: { amountCents: true, refundedCents: true },
      },
      tenant: {
        select: {
          legalName: true,
          displayName: true,
          contactEmail: true,
          contactPhone: true,
          address: true,
          taxId: true,
          taxIdType: true,
          branding: true,
        },
      },
      case: {
        select: {
          client: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      },
    },
  });
  if (!inv) throw new Error('Invoice not found');

  if (inv.pdfR2Key) {
    return signedUrl(inv.pdfR2Key);
  }

  const paid = inv.payments.reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
  const balance = Math.max(0, inv.totalCents - paid);

  const branding = (inv.tenant.branding ?? {}) as InvoicePdfBranding;
  const buf = await renderInvoicePdf({
    branding,
    tenant: {
      legalName: inv.tenant.legalName,
      displayName: inv.tenant.displayName,
      contactEmail: inv.tenant.contactEmail,
      contactPhone: inv.tenant.contactPhone,
      address: (inv.tenant.address as InvoicePdfTenantAddress | null) ?? null,
      taxId: inv.tenant.taxId,
      taxIdType: inv.tenant.taxIdType,
    },
    client: inv.case.client,
    invoice: {
      number: inv.number,
      status: inv.status,
      currency: inv.currency,
      subtotalCents: inv.subtotalCents,
      taxCents: inv.taxCents,
      totalCents: inv.totalCents,
      paidCents: paid,
      balanceCents: balance,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      notes: inv.notes,
      items: inv.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        taxRateBp: it.taxRateBp,
        amountCents: it.amountCents,
      })),
    },
  });

  const key = r2KeyFor(inv.tenantId, inv.id);
  await uploadBuffer(key, buf, 'application/pdf');
  await prisma.caseInvoice.update({
    where: { id: inv.id },
    data: { pdfR2Key: key, pdfRenderedAt: new Date() },
  });
  return signedUrl(key);
}

type InvoicePdfTenantAddress = {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
};
