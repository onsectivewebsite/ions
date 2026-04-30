# Privacy policy

> **DRAFT v0.1 — review with privacy counsel before publishing.**
> Last updated: [DATE]

This privacy policy describes how **Onsective Inc.** ("Onsective", "we", "us") collects, uses, and discloses personal information about visitors to onsective.cloud and people who sign up for OnsecBoad. It is governed by Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial privacy laws including Quebec's Law 25.

**This policy does NOT cover the personal information of clients of law firms that use OnsecBoad.** That data belongs to each law firm; their own privacy policy governs its handling. Onsective is a processor of that information on behalf of each firm — see `infra/legal/dpa-template.md` for the controller/processor relationship.

## 1. Who we are

Onsective Inc.
[Registered address]
Ontario, Canada
Privacy Officer: [name]
Contact: privacy@onsective.com

## 2. Personal information we collect

### From visitors to onsective.cloud (marketing site)

- IP address, user-agent, language preference (logged for security + analytics)
- Cookies — see § 7

### From people who sign up for OnsecBoad

- Name, work email, work phone number
- Firm legal name + address + tax ID (for invoicing)
- Billing contact details + payment method (handled by Stripe — we never store full card numbers)
- Authentication data: hashed password (argon2id), TOTP secret if enrolled, passkey public key if enrolled

### From firm admins administering their OnsecBoad workspace

- IP address + user-agent on each sign-in (used to detect unauthorized access)
- Audit log of administrative actions
- Push notification device tokens (when they install the OnsecBoad mobile app)

### From people who contact us for support

- Email address, content of the message, any attachments

## 3. Why we collect it (purposes)

- **Provide the service**: authenticate, authorize, render the workspace.
- **Bill the subscription**: invoice generation, payment processing, dunning.
- **Secure the service**: detect unauthorized access, investigate incidents.
- **Comply with the law**: respond to lawful requests; honour right-to-access / right-to-deletion requests; meet record-retention obligations.
- **Improve the service**: aggregated, de-identified usage analytics. We do NOT use your firm's data — or your firm's clients' data — to train AI models.

## 4. Lawful basis under PIPEDA

We rely primarily on the **necessity to perform a contract** with you (the subscribing firm) and your **explicit consent** for any optional processing (e.g. marketing emails, which you can decline at sign-up and unsubscribe from at any time).

## 5. Disclosure to sub-processors

To deliver the service we share certain personal information with vendors we have contracted with. The current list is at `infra/legal/sub-processors.md` (also published at onsective.cloud/sub-processors).

## 6. International transfers

OnsecBoad is hosted in Canada (Hostinger Canadian region + Cloudflare R2 with Canadian / US edge). Personal information may transit through US-based sub-processors (Stripe, Anthropic, Twilio) when you use those features. We require contractual safeguards (DPAs / standard contractual clauses where applicable) with every sub-processor.

## 7. Cookies

onsective.cloud uses:

- **Strictly-necessary cookies** for sign-in session state.
- **First-party analytics cookies** (no third-party tracking) measuring page visits in aggregate.

We do not use advertising cookies. You can disable cookies in your browser; some features will not work.

## 8. Retention

| Data | Retention |
|---|---|
| Active firm + user records | Duration of subscription |
| Subscription invoices + payment records | 7 years (Canada Revenue Agency requirement) |
| Audit logs | 7 years |
| Marketing email subscribers | Until unsubscribe + 30 days |
| Backup snapshots | 30 days rolling |
| Support correspondence | 24 months |

After the relevant period, data is anonymised or deleted.

## 9. Your rights under PIPEDA

You have the right to:

- **Access** your personal information.
- **Correct** inaccurate information.
- **Withdraw consent** for optional processing.
- **Object** to specific uses.
- **Lodge a complaint** with the Office of the Privacy Commissioner of Canada (OPC) or your provincial commissioner if applicable.

To exercise any of these rights, contact privacy@onsective.com. We respond within 30 days.

## 10. Quebec Law 25 callouts

If you reside in Quebec:
- Our Privacy Officer (named in § 1) is responsible for the protection of your personal information.
- You may request a transfer of your information in a structured, commonly-used technological format.
- We will notify you of any incident posing a risk of serious harm.

## 11. Children

OnsecBoad is a B2B service. We do not knowingly collect personal information from individuals under 16. If we discover such information, we will delete it.

## 12. Changes to this policy

We post material changes here and email firm admins at least 30 days before the change takes effect. The "Last updated" date at the top reflects the most recent revision.

## 13. Contact

privacy@onsective.com
[Registered address]
Privacy Officer: [name]

To complain to a regulator:
- Office of the Privacy Commissioner of Canada — https://www.priv.gc.ca
- Quebec Commission d'accès à l'information — https://www.cai.gouv.qc.ca
