/**
 * Branded case-invoice PDF rendering — Phase 7.3.
 *
 * Server-side pdfkit. Outputs a single-page (multi-page when items
 * overflow) Letter-size invoice with:
 *
 *   - Header band tinted with the firm's theme primary
 *   - Firm legalName + address (right side)
 *   - Bill To client block (left)
 *   - Invoice #, issue date, due date metadata
 *   - Line items table with description / qty / unit / tax / amount
 *   - Subtotal / Tax / Total summary
 *   - PAID watermark stamp when the invoice has cleared
 *   - Notes footer
 *
 * Theme colors come from `@onsecboad/config/themes`, so a Maple firm
 * sees their dark-red header, a Forest firm sees their green, etc.
 */
import PDFDocument from 'pdfkit';
import { THEME_PRESETS, buildCustomTheme, type ThemeCode } from '@onsecboad/config/themes';

export type InvoicePdfBranding = {
  themeCode?: ThemeCode | null;
  customPrimary?: string | null;
};

export type InvoicePdfTenant = {
  legalName: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  address: { line1?: string; line2?: string; city?: string; province?: string; postalCode?: string; country?: string } | null;
  taxId: string | null;
  taxIdType: string | null;
};

export type InvoicePdfClient = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

export type InvoicePdfData = {
  number: string;
  status: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  issueDate: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  notes: string | null;
  items: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    taxRateBp: number;
    amountCents: number;
  }>;
};

function resolvePrimary(b: InvoicePdfBranding): string {
  if (b.themeCode === 'custom' && b.customPrimary) {
    return buildCustomTheme(b.customPrimary).tokens.color.primary;
  }
  const code = b.themeCode && b.themeCode !== 'custom' ? b.themeCode : 'maple';
  return (THEME_PRESETS[code] ?? THEME_PRESETS.maple).tokens.color.primary;
}

function fmt(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString('en-CA') : '—';
}

export async function renderInvoicePdf(args: {
  branding: InvoicePdfBranding;
  tenant: InvoicePdfTenant;
  client: InvoicePdfClient;
  invoice: InvoicePdfData;
}): Promise<Buffer> {
  const { branding, tenant, client, invoice } = args;
  const primary = resolvePrimary(branding);
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });

  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<void>((resolve) => {
    doc.on('end', () => resolve());
  });

  // Top color stripe — pure visual brand cue.
  doc.rect(0, 0, doc.page.width, 8).fill(primary);
  doc.fillColor('black');

  // Header — firm name (left) + INVOICE label (right)
  doc.font('Helvetica-Bold').fontSize(20).text(tenant.displayName, 50, 32);
  doc
    .font('Helvetica-Bold')
    .fontSize(28)
    .fillColor(primary)
    .text('INVOICE', 50, 32, { align: 'right' });
  doc.fillColor('black');

  // Firm contact details — right column under the INVOICE label
  doc.font('Helvetica').fontSize(9);
  let rightCursor = 65;
  const rightX = 350;
  const rightW = doc.page.width - 50 - rightX;
  if (tenant.legalName !== tenant.displayName) {
    doc.text(tenant.legalName, rightX, rightCursor, { width: rightW, align: 'right' });
    rightCursor += 12;
  }
  const a = tenant.address;
  if (a) {
    const lines = [
      [a.line1, a.line2].filter(Boolean).join(', '),
      [a.city, a.province, a.postalCode].filter(Boolean).join(' '),
      a.country,
    ].filter((s) => s && s.length > 0);
    for (const l of lines) {
      doc.text(l!, rightX, rightCursor, { width: rightW, align: 'right' });
      rightCursor += 12;
    }
  }
  if (tenant.contactEmail) {
    doc.text(tenant.contactEmail, rightX, rightCursor, { width: rightW, align: 'right' });
    rightCursor += 12;
  }
  if (tenant.contactPhone) {
    doc.text(tenant.contactPhone, rightX, rightCursor, { width: rightW, align: 'right' });
    rightCursor += 12;
  }
  if (tenant.taxId) {
    doc.text(
      `${(tenant.taxIdType ?? '').replace('_', ' ').toUpperCase()} ${tenant.taxId}`.trim(),
      rightX,
      rightCursor,
      { width: rightW, align: 'right' },
    );
    rightCursor += 12;
  }

  // Bill To block
  const billY = Math.max(rightCursor, 75) + 18;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('BILL TO', 50, billY);
  doc.font('Helvetica').fontSize(11).fillColor('black');
  const fullName =
    [client.firstName, client.lastName].filter(Boolean).join(' ') || '(client)';
  doc.text(fullName, 50, billY + 14);
  let billCursor = billY + 28;
  if (client.email) {
    doc.fontSize(9).fillColor('#444').text(client.email, 50, billCursor);
    billCursor += 12;
  }
  if (client.phone) {
    doc.fontSize(9).fillColor('#444').text(client.phone, 50, billCursor);
    billCursor += 12;
  }

  // Metadata block (right of Bill To)
  const metaX = 350;
  const metaW = doc.page.width - 50 - metaX;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666');
  doc.text('INVOICE #', metaX, billY, { width: metaW, align: 'right' });
  doc.text('ISSUED', metaX, billY + 28, { width: metaW, align: 'right' });
  doc.text('DUE', metaX, billY + 56, { width: metaW, align: 'right' });
  doc.font('Helvetica').fontSize(11).fillColor('black');
  doc.text(invoice.number, metaX, billY + 12, { width: metaW, align: 'right' });
  doc.text(fmtDate(invoice.issueDate), metaX, billY + 40, { width: metaW, align: 'right' });
  doc.text(fmtDate(invoice.dueDate), metaX, billY + 68, { width: metaW, align: 'right' });

  // Items table
  const tableTop = Math.max(billCursor, billY + 96) + 24;
  const tableX = 50;
  const tableW = doc.page.width - 100;
  // Column widths sum = tableW (512 at margin=50 on Letter)
  const colDesc = 240;
  const colQty = 50;
  const colUnit = 80;
  const colTax = 60;
  const colAmt = tableW - colDesc - colQty - colUnit - colTax;

  // Header row
  doc.rect(tableX, tableTop, tableW, 22).fill(primary);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(9);
  let cx = tableX + 8;
  doc.text('DESCRIPTION', cx, tableTop + 7, { width: colDesc - 8 });
  cx += colDesc;
  doc.text('QTY', cx, tableTop + 7, { width: colQty - 8, align: 'right' });
  cx += colQty;
  doc.text('UNIT', cx, tableTop + 7, { width: colUnit - 8, align: 'right' });
  cx += colUnit;
  doc.text('TAX', cx, tableTop + 7, { width: colTax - 8, align: 'right' });
  cx += colTax;
  doc.text('AMOUNT', cx, tableTop + 7, { width: colAmt - 8, align: 'right' });

  // Item rows — pdfkit handles page breaks for us when y > pageHeight; we
  // help it by tracking y manually so the summary block lands cleanly.
  doc.fillColor('black').font('Helvetica').fontSize(10);
  let y = tableTop + 22;
  for (const it of invoice.items) {
    const descHeight = doc.heightOfString(it.description, { width: colDesc - 8 });
    const rowHeight = Math.max(20, descHeight + 8);

    // Page break if needed before drawing the row
    if (y + rowHeight > doc.page.height - 140) {
      doc.addPage();
      y = 60;
    }

    cx = tableX + 8;
    doc.text(it.description, cx, y + 4, { width: colDesc - 8 });
    cx += colDesc;
    doc.text(String(it.quantity), cx, y + 4, { width: colQty - 8, align: 'right' });
    cx += colQty;
    doc.text(fmt(it.unitPriceCents, invoice.currency), cx, y + 4, {
      width: colUnit - 8,
      align: 'right',
    });
    cx += colUnit;
    doc.text(`${(it.taxRateBp / 100).toFixed(2)}%`, cx, y + 4, {
      width: colTax - 8,
      align: 'right',
    });
    cx += colTax;
    doc.font('Helvetica-Bold').text(fmt(it.amountCents, invoice.currency), cx, y + 4, {
      width: colAmt - 8,
      align: 'right',
    });
    doc.font('Helvetica');

    // Hairline row separator
    doc
      .strokeColor('#dddddd')
      .lineWidth(0.5)
      .moveTo(tableX, y + rowHeight)
      .lineTo(tableX + tableW, y + rowHeight)
      .stroke();
    y += rowHeight;
  }

  // Summary block — right-aligned three-row total panel
  const summaryY = y + 16;
  const labelX = tableX + tableW - 220;
  const valueX = tableX + tableW - 8;
  const valueW = 100;

  function summaryRow(label: string, value: string, opts?: { bold?: boolean; tone?: 'muted' | 'primary' }) {
    doc.font(opts?.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts?.bold ? 12 : 10);
    doc.fillColor(
      opts?.tone === 'primary' ? primary : opts?.tone === 'muted' ? '#666666' : 'black',
    );
    doc.text(label, labelX, doc.y, { continued: false });
    doc.text(value, valueX - valueW, doc.y - doc.currentLineHeight(), {
      width: valueW,
      align: 'right',
    });
  }

  doc.y = summaryY;
  summaryRow('Subtotal', fmt(invoice.subtotalCents, invoice.currency), { tone: 'muted' });
  summaryRow('Tax', fmt(invoice.taxCents, invoice.currency), { tone: 'muted' });
  doc
    .strokeColor(primary)
    .lineWidth(1.2)
    .moveTo(labelX, doc.y + 4)
    .lineTo(valueX, doc.y + 4)
    .stroke();
  doc.moveDown(0.6);
  summaryRow('Total', fmt(invoice.totalCents, invoice.currency), { bold: true, tone: 'primary' });

  if (invoice.paidCents > 0) {
    doc.moveDown(0.4);
    summaryRow(
      invoice.balanceCents > 0 ? 'Paid to date' : 'Paid',
      fmt(invoice.paidCents, invoice.currency),
      { tone: 'muted' },
    );
    if (invoice.balanceCents > 0) {
      doc.moveDown(0.2);
      summaryRow(
        'Balance due',
        fmt(invoice.balanceCents, invoice.currency),
        { bold: true, tone: 'primary' },
      );
    }
  }

  // PAID stamp — diagonal text overlay (status === 'PAID' OR balance == 0
  // when total > 0). Positioned near the items table for visibility.
  if (invoice.status === 'PAID' || (invoice.totalCents > 0 && invoice.balanceCents === 0)) {
    doc.save();
    const stampX = tableX + 60;
    const stampY = tableTop + 60;
    doc.translate(stampX, stampY).rotate(-18, { origin: [0, 0] });
    doc
      .lineWidth(3)
      .strokeColor(primary)
      .roundedRect(0, 0, 220, 78, 8)
      .stroke();
    doc.font('Helvetica-Bold').fontSize(46).fillColor(primary).text('PAID', 30, 14);
    if (invoice.paidAt) {
      doc.font('Helvetica').fontSize(9).fillColor(primary).text(fmtDate(invoice.paidAt), 30, 60);
    }
    doc.restore();
    doc.fillColor('black');
  }

  // Notes footer
  if (invoice.notes && invoice.notes.trim()) {
    if (doc.y > doc.page.height - 130) doc.addPage();
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#666666').text('NOTES', tableX, doc.y);
    doc.font('Helvetica').fontSize(10).fillColor('black').text(invoice.notes.trim(), tableX, doc.y + 4, {
      width: tableW,
    });
  }

  // Page footer (every page) — small disclaimer + firm name
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 40;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#999999')
      .text(
        `${tenant.displayName} · Invoice ${invoice.number} · Page ${i + 1} of ${pages.count}`,
        50,
        footerY,
        { width: doc.page.width - 100, align: 'center' },
      );
  }

  doc.end();
  await done;
  return Buffer.concat(chunks);
}
