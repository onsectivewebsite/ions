'use client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CircleDollarSign, FileText, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Input, Label, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'VOID';
type PaymentStatus = 'COMPLETED' | 'PARTIAL_REFUND' | 'REFUNDED' | 'VOIDED';
type PaymentMethod = 'card' | 'cash' | 'etransfer' | 'cheque' | 'wire' | 'stripe';

type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  taxRateBp: number;
  amountCents: number;
  sortOrder: number;
};

type Payment = {
  id: string;
  amountCents: number;
  refundedCents: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string | null;
  note: string | null;
  receivedAt: string;
  invoiceId: string | null;
  invoice: { id: string; number: string; status: InvoiceStatus } | null;
};

type Invoice = {
  id: string;
  number: string;
  status: InvoiceStatus;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  issueDate: string;
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  notes: string | null;
  items: InvoiceItem[];
  payments: Array<{ id: string; amountCents: number; refundedCents: number; status: PaymentStatus }>;
};

const STATUS_TONE: Record<InvoiceStatus, 'success' | 'warning' | 'neutral' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'warning',
  PARTIAL: 'warning',
  PAID: 'success',
  VOID: 'danger',
};

function fmtMoney(c: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(c / 100);
}

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString() : '—';
}

function invoicePaid(inv: Invoice): number {
  return inv.payments
    .filter((p) => p.status !== 'VOIDED')
    .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
}

export function BillingCard({
  caseId,
  feesTarget,
  onChanged,
  onError,
}: {
  caseId: string;
  feesTarget: number | null;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [recording, setRecording] = useState<{ invoiceId: string | null } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const totals = useMemo(() => {
    if (!invoices || !payments) return null;
    const invoiceTotal = invoices
      .filter((i) => i.status !== 'VOID')
      .reduce((s, i) => s + i.totalCents, 0);
    const ledgerPaid = payments
      .filter((p) => p.status !== 'VOIDED')
      .reduce((s, p) => s + p.amountCents - p.refundedCents, 0);
    return { invoiceTotal, ledgerPaid };
  }, [invoices, payments]);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const [inv, pay] = await Promise.all([
        rpcQuery<Invoice[]>('caseInvoice.list', { caseId }, { token }),
        rpcQuery<Payment[]>('casePayment.list', { caseId }, { token }),
      ]);
      setInvoices(inv);
      setPayments(pay);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load billing');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function refresh(): Promise<void> {
    await load();
    await onChanged();
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Billing</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setRecording({ invoiceId: null })}>
            <CircleDollarSign size={12} /> Record payment
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={12} /> New invoice
          </Button>
        </div>
      </div>

      {feesTarget != null && totals ? (
        <div className="mt-3 grid grid-cols-3 gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-sm">
          <Stat label="Fee target" value={fmtMoney(feesTarget)} />
          <Stat label="Paid" value={fmtMoney(totals.ledgerPaid)} />
          <Stat
            label="Outstanding"
            value={fmtMoney(Math.max(0, feesTarget - totals.ledgerPaid))}
            tone={totals.ledgerPaid >= feesTarget ? 'success' : 'warning'}
          />
        </div>
      ) : null}

      {creating ? (
        <InvoiceEditor
          caseId={caseId}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await refresh();
          }}
          onError={onError}
        />
      ) : null}

      {recording ? (
        <RecordPaymentForm
          caseId={caseId}
          invoiceId={recording.invoiceId}
          openInvoices={(invoices ?? []).filter(
            (i) => i.status !== 'VOID' && i.status !== 'PAID' && i.status !== 'DRAFT',
          )}
          onClose={() => setRecording(null)}
          onSaved={async () => {
            setRecording(null);
            await refresh();
          }}
          onError={onError}
        />
      ) : null}

      <div className="mt-4">
        <h4 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Invoices
        </h4>
        {invoices === null ? (
          <div className="text-xs text-[var(--color-text-muted)]">Loading…</div>
        ) : invoices.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-6 text-center text-xs text-[var(--color-text-muted)]">
            <FileText size={20} className="mx-auto mb-2 opacity-40" />
            No invoices yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                inv={inv}
                editing={editingId === inv.id}
                onEdit={() => setEditingId(inv.id)}
                onCloseEdit={() => setEditingId(null)}
                onChanged={refresh}
                onError={onError}
                onRecordPayment={() => setRecording({ invoiceId: inv.id })}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h4 className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Payments
        </h4>
        {payments === null ? (
          <div className="text-xs text-[var(--color-text-muted)]">Loading…</div>
        ) : payments.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-4 text-center text-xs text-[var(--color-text-muted)]">
            No payments recorded yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {payments.map((p) => (
              <PaymentRow key={p.id} p={p} onChanged={refresh} onError={onError} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning';
}) {
  const toneCls =
    tone === 'success'
      ? 'text-[var(--color-success)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : '';
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function InvoiceRow({
  inv,
  editing,
  onEdit,
  onCloseEdit,
  onChanged,
  onError,
  onRecordPayment,
}: {
  inv: Invoice;
  editing: boolean;
  onEdit: () => void;
  onCloseEdit: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
  onRecordPayment: () => void;
}) {
  const paid = invoicePaid(inv);
  const balance = Math.max(0, inv.totalCents - paid);

  async function send(): Promise<void> {
    try {
      const token = getAccessToken();
      await rpcMutation('caseInvoice.send', { id: inv.id }, { token });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Send failed');
    }
  }

  async function voidIt(): Promise<void> {
    const reason = prompt('Reason for voiding this invoice?');
    if (!reason || reason.trim().length < 2) return;
    try {
      const token = getAccessToken();
      await rpcMutation('caseInvoice.void', { id: inv.id, reason: reason.trim() }, { token });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Void failed');
    }
  }

  async function deleteIt(): Promise<void> {
    if (!confirm(`Delete invoice ${inv.number}? Only DRAFT invoices can be deleted.`)) return;
    try {
      const token = getAccessToken();
      await rpcMutation('caseInvoice.delete', { id: inv.id }, { token });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium">{inv.number}</span>
            <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Issued {fmtDate(inv.issueDate)}
            {inv.dueDate ? ` · Due ${fmtDate(inv.dueDate)}` : ''}
            {inv.sentAt ? ` · Sent ${fmtDate(inv.sentAt)}` : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{fmtMoney(inv.totalCents, inv.currency)}</div>
          <div className="text-xs text-[var(--color-text-muted)]">
            {fmtMoney(paid, inv.currency)} paid · {fmtMoney(balance, inv.currency)} owing
          </div>
        </div>
      </div>

      {!editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {inv.status === 'DRAFT' ? (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void send()}>
                <Send size={12} /> Send
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void deleteIt()}>
                <Trash2 size={12} /> Delete
              </Button>
            </>
          ) : null}
          {inv.status !== 'VOID' && inv.status !== 'PAID' && inv.status !== 'DRAFT' ? (
            <Button size="sm" variant="secondary" onClick={onRecordPayment}>
              <CircleDollarSign size={12} /> Record payment
            </Button>
          ) : null}
          {inv.status !== 'VOID' && inv.status !== 'DRAFT' ? (
            <Button size="sm" variant="ghost" onClick={() => void voidIt()}>
              <X size={12} /> Void
            </Button>
          ) : null}
        </div>
      ) : (
        <InvoiceEditor
          caseId="" // not used in edit mode
          existing={inv}
          onClose={onCloseEdit}
          onSaved={async () => {
            onCloseEdit();
            await onChanged();
          }}
          onError={onError}
        />
      )}
    </li>
  );
}

function PaymentRow({
  p,
  onChanged,
  onError,
}: {
  p: Payment;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const tone =
    p.status === 'VOIDED'
      ? 'danger'
      : p.status === 'REFUNDED'
        ? 'danger'
        : p.status === 'PARTIAL_REFUND'
          ? 'warning'
          : 'success';

  async function refund(): Promise<void> {
    const remaining = p.amountCents - p.refundedCents;
    const raw = prompt(
      `Refund amount (CAD), up to ${fmtMoney(remaining)}?`,
      String((remaining / 100).toFixed(2)),
    );
    if (!raw) return;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents <= 0) return;
    try {
      const token = getAccessToken();
      await rpcMutation('casePayment.refund', { id: p.id, amountCents: cents }, { token });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Refund failed');
    }
  }

  async function voidPayment(): Promise<void> {
    const reason = prompt('Reason for voiding this payment? (e.g. cheque bounced)');
    if (!reason || reason.trim().length < 2) return;
    try {
      const token = getAccessToken();
      await rpcMutation('casePayment.void', { id: p.id, reason: reason.trim() }, { token });
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Void failed');
    }
  }

  return (
    <li className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border-muted)] px-3 py-2 text-sm">
      <div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{p.status.replace('_', ' ')}</Badge>
          <span className="font-medium">{fmtMoney(p.amountCents)}</span>
          {p.refundedCents > 0 ? (
            <span className="text-xs text-[var(--color-text-muted)]">
              (refunded {fmtMoney(p.refundedCents)})
            </span>
          ) : null}
          <span className="text-xs uppercase text-[var(--color-text-muted)]">{p.method}</span>
          {p.invoice ? (
            <span className="text-xs text-[var(--color-text-muted)]">→ {p.invoice.number}</span>
          ) : null}
        </div>
        <div className="text-xs text-[var(--color-text-muted)]">
          {new Date(p.receivedAt).toLocaleString()}
          {p.reference ? ` · ${p.reference}` : ''}
          {p.note ? ` · ${p.note}` : ''}
        </div>
      </div>
      {p.status !== 'VOIDED' && p.status !== 'REFUNDED' ? (
        <div className="flex items-center gap-1">
          <button
            onClick={() => void refund()}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-surface-muted)]"
          >
            <RotateCcw size={11} className="inline" /> Refund
          </button>
          <button
            onClick={() => void voidPayment()}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
          >
            Void
          </button>
        </div>
      ) : null}
    </li>
  );
}

function InvoiceEditor({
  caseId,
  existing,
  onClose,
  onSaved,
  onError,
}: {
  caseId: string;
  existing?: Invoice;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [items, setItems] = useState<
    Array<{ description: string; quantity: number; unitPriceCents: number; taxRateBp: number }>
  >(() => {
    if (existing) {
      return existing.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        taxRateBp: i.taxRateBp,
      }));
    }
    return [{ description: '', quantity: 1, unitPriceCents: 0, taxRateBp: 1300 }];
  });
  const [dueDate, setDueDate] = useState<string>(
    existing?.dueDate ? existing.dueDate.slice(0, 10) : '',
  );
  const [notes, setNotes] = useState<string>(existing?.notes ?? '');
  const [busy, setBusy] = useState(false);

  function update(idx: number, patch: Partial<(typeof items)[number]>): void {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addRow(): void {
    setItems((prev) => [...prev, { description: '', quantity: 1, unitPriceCents: 0, taxRateBp: 1300 }]);
  }

  function removeRow(idx: number): void {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const totals = useMemo(() => {
    let sub = 0;
    let total = 0;
    for (const it of items) {
      const pre = it.quantity * it.unitPriceCents;
      sub += pre;
      total += Math.round(pre * (1 + it.taxRateBp / 10_000));
    }
    return { subtotal: sub, tax: total - sub, total };
  }, [items]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (items.some((it) => !it.description.trim())) {
      onError('Every line item needs a description.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const payload = {
        items: items.map((it) => ({
          description: it.description.trim(),
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          taxRateBp: it.taxRateBp,
        })),
        notes: notes.trim() || undefined,
        dueDate: dueDate ? new Date(dueDate + 'T23:59:59').toISOString() : undefined,
      };
      if (existing) {
        await rpcMutation(
          'caseInvoice.update',
          { id: existing.id, ...payload },
          { token },
        );
      } else {
        await rpcMutation('caseInvoice.create', { caseId, ...payload }, { token });
      }
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
    >
      <div className="mb-2 text-sm font-medium">
        {existing ? `Edit ${existing.number}` : 'New invoice'}
      </div>

      <div className="space-y-2">
        {items.map((it, idx) => (
          <div
            key={idx}
            className="grid grid-cols-12 items-end gap-2 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface)] p-2"
          >
            <div className="col-span-5">
              <Label>Description</Label>
              <Input
                value={it.description}
                onChange={(e) => update(idx, { description: e.target.value })}
                placeholder="Retainer fee — Work permit"
                required
              />
            </div>
            <div className="col-span-2">
              <Label>Qty</Label>
              <Input
                type="number"
                min={1}
                value={it.quantity}
                onChange={(e) => update(idx, { quantity: Math.max(1, Number(e.target.value)) })}
              />
            </div>
            <div className="col-span-2">
              <Label>Unit (CAD)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={(it.unitPriceCents / 100).toString()}
                onChange={(e) =>
                  update(idx, { unitPriceCents: Math.round(Number(e.target.value) * 100) })
                }
              />
            </div>
            <div className="col-span-2">
              <Label>Tax %</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={(it.taxRateBp / 100).toString()}
                onChange={(e) =>
                  update(idx, { taxRateBp: Math.round(Number(e.target.value) * 100) })
                }
              />
            </div>
            <div className="col-span-1">
              <button
                type="button"
                onClick={() => removeRow(idx)}
                disabled={items.length === 1}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-danger)] disabled:opacity-30"
                aria-label="Remove line"
              >
                <Trash2 size={12} className="mx-auto" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <Button size="sm" variant="ghost" type="button" onClick={addRow}>
          <Plus size={12} /> Add line
        </Button>
        <div className="text-right text-sm">
          <div className="text-xs text-[var(--color-text-muted)]">
            Subtotal {fmtMoney(totals.subtotal)} · Tax {fmtMoney(totals.tax)}
          </div>
          <div className="text-base font-semibold">{fmtMoney(totals.total)}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <Label>Due date</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div>
          <Label>Notes (visible on invoice)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={busy}>
          {busy ? <Spinner /> : null} Save
        </Button>
      </div>
    </form>
  );
}

function RecordPaymentForm({
  caseId,
  invoiceId,
  openInvoices,
  onClose,
  onSaved,
  onError,
}: {
  caseId: string;
  invoiceId: string | null;
  openInvoices: Invoice[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (m: string) => void;
}) {
  const [amount, setAmount] = useState<string>('');
  const [method, setMethod] = useState<PaymentMethod>('etransfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [targetInvoiceId, setTargetInvoiceId] = useState<string>(invoiceId ?? '');
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'casePayment.record',
        {
          caseId,
          invoiceId: targetInvoiceId || null,
          amountCents: Math.round(Number(amount) * 100),
          method,
          reference: reference || undefined,
          note: note || undefined,
          receivedAt: new Date(receivedAt).toISOString(),
        },
        { token },
      );
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Record failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
    >
      <div className="mb-2 text-sm font-medium">Record payment</div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Amount (CAD)</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            placeholder="500.00"
          />
        </div>
        <div>
          <Label>Method</Label>
          <select
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            <option value="etransfer">e-Transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="card">Card (manual)</option>
            <option value="wire">Wire</option>
            <option value="stripe">Stripe</option>
          </select>
        </div>
        <div>
          <Label>Reference (optional)</Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Cheque #, e-Transfer code, etc"
          />
        </div>
        <div>
          <Label>Apply to invoice</Label>
          <select
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
            value={targetInvoiceId}
            onChange={(e) => setTargetInvoiceId(e.target.value)}
          >
            <option value="">(unallocated — case credit)</option>
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} ({fmtMoney(i.totalCents)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>Received</Label>
          <Input
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            required
          />
        </div>
        <div>
          <Label>Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={busy || !amount}>
          {busy ? <Spinner /> : <CircleDollarSign size={12} />} Record payment
        </Button>
      </div>
    </form>
  );
}
