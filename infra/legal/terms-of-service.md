# Terms of Service

> **DRAFT v0.1 — review with counsel before any external use.**
> Last updated: [DATE]

These Terms govern your firm's subscription to OnsecBoad, the SaaS platform operated by Onsective Inc. ("Onsective", "we"). The firm executing the subscription ("Firm", "you") agrees to these Terms by completing setup at /setup.

## 1. The service

OnsecBoad is a web + mobile application providing CRM, case management, document collection, e-signature, billing, secure messaging, AI extraction + classification + agent capabilities, and lobby-display features for Canadian immigration law firms.

## 2. Subscription, billing, auto-renewal

### 2.1 Plan

You select a plan at sign-up: STARTER, GROWTH, or SCALE. Plan features and seat limits are listed at onsective.cloud/pricing. Pricing is per-seat-per-month, billed in CAD via Stripe.

### 2.2 Trial

Each new firm gets a 14-day free trial starting on setup completion. During the trial we collect a card on file via Stripe; we do not charge until the trial ends. Cancel before the trial ends and you owe nothing.

### 2.3 Auto-renewal

Subscriptions renew monthly on the original setup date. We notify you 7 days before any planned price change.

### 2.4 Seats

A "seat" is one active or invited billable user. Adding users via the firm-admin UI auto-bills on the next monthly invoice. Disabling or deleting a user releases their seat for the following month.

### 2.5 Failed payment

If a payment fails Stripe retries per its standard schedule. After 14 days of failure, the subscription is suspended and the firm-admin user receives notice. The workspace remains read-only until payment clears; after 30 days, the subscription is canceled and the workspace is queued for deletion (subject to § 5.4).

## 3. Acceptable use

You agree not to use OnsecBoad to:

- Violate any applicable law (including PIPEDA, CASL, Canada's Anti-Spam Law);
- Send unsolicited bulk marketing without compliant consent;
- Upload malicious code, attempt to compromise the system, or probe other tenants;
- Access another firm's data;
- Reverse-engineer the platform.

We may suspend or terminate access for violations, with or without notice depending on severity.

## 4. Data ownership + control

### 4.1 Your data

You retain ownership of all personal information about your clients that you upload to OnsecBoad. We process it on your behalf as a data processor under PIPEDA. The data processing agreement at `infra/legal/dpa-template.md` (executable on request) governs this relationship.

### 4.2 Your aggregate usage data

We may compute aggregated, de-identified usage metrics (counts of cases, lead-source mix, AI usage in tokens) for our own product analytics. We will not publish or share information that identifies your firm or its clients.

### 4.3 No model training on your data

We do not use your firm's data, your firm's clients' data, document uploads, transcripts, or message content to train AI models. The Anthropic API we use is configured with no-retention policies where available.

### 4.4 Data export

Available at any time during the subscription via the firm-admin UI (Settings → Data export — full firm dump as JSON + R2 signed URLs). Available within 30 days of subscription termination.

## 5. Suspension + termination

### 5.1 By you

Cancel from Settings → Billing or by emailing support@onsective.com. Cancellation takes effect at the end of the current billing period. We do not pro-rate refunds for partial months.

### 5.2 By us, for cause

We may suspend or terminate immediately on:
- Violation of § 3 (Acceptable use);
- Non-payment past § 2.5's grace window;
- Order of a court or competent authority.

### 5.3 By us, without cause

We may terminate any subscription with 60 days' written notice. We will refund any pre-paid amount for service not yet delivered.

### 5.4 What happens to your data on termination

- **Day 0–30**: data remains, in read-only mode, available for export.
- **Day 31–60**: data is offline but recoverable on request.
- **Day 61+**: data is permanently deleted, except for data Onsective is legally required to retain (subscription invoices for 7 years per CRA, audit logs for 7 years per s.10.3 PIPEDA breach record-keeping).

You can accelerate deletion at any time via the data-rights export → request-deletion flow (see § 6).

## 6. Privacy + breach notification

We comply with PIPEDA's breach notification regulations. If we become aware of a breach affecting your firm's data that poses a real risk of significant harm, we will notify you within 24 hours of confirmation. Your firm is responsible for downstream notification to its own clients per PIPEDA s. 10.1; we provide a template at `infra/legal/breach-notification-individual.md`.

## 7. Service levels

### 7.1 Uptime

Target: 99.5% monthly availability, calculated on /api/health/full. Status page at onsective.cloud/status.

### 7.2 Support

- Email: support@onsective.com
- SEV-1 / SEV-2 acknowledgement: same business day
- SEV-3 / SEV-4: best-effort

### 7.3 Maintenance

Planned maintenance occurs in the off-peak window 02:00–06:00 ET. We post advance notice on the status page.

## 8. Limit of liability

To the maximum extent permitted by law, Onsective's total liability under these Terms is limited to the amount you paid in the 12 months preceding the event giving rise to the claim. Onsective is not liable for indirect, consequential, or punitive damages, including lost profits, lost data (when caused by user action — see § 4.4 for our retention obligations), or business interruption.

This limitation does NOT apply to:
- Our indemnification obligations under § 9;
- Gross negligence or wilful misconduct;
- Claims arising from a breach of the data processing agreement.

## 9. Indemnity

We will defend and indemnify you against any third-party claim alleging that OnsecBoad infringes that party's intellectual property rights, provided you give prompt notice + cooperation.

You will defend and indemnify Onsective against any third-party claim arising from:
- Your use of OnsecBoad in violation of § 3 (Acceptable use);
- The personal information you upload, including any claim that you lacked authority to upload it;
- Your firm's failure to comply with PIPEDA's controller obligations.

## 10. Confidentiality

Each party will protect the other's confidential information with the same care it uses for its own (no less than reasonable care). This survives termination indefinitely for trade secrets; 5 years for other confidential information.

## 11. Governing law + venue

Ontario, Canada law governs these Terms. Disputes are resolved in the courts of Ontario unless mandatory law requires otherwise.

## 12. Changes

We may update these Terms with 30 days' email notice to firm admins for material changes; immediately for changes required by law.

## 13. Entire agreement

These Terms + the executed DPA + the privacy policy form the entire agreement between Onsective and your firm regarding OnsecBoad.

## Signatures

- **Onsective Inc.**
  By: ____________________________
  Name: [Founder name]
  Title: Founder / President
  Date: ____________________________

- **Firm**
  By: ____________________________
  Name: ____________________________
  Title: ____________________________
  Date: ____________________________
