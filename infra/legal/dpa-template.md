# Data Processing Agreement

> **DRAFT v0.1 — review with privacy counsel before signing.**

**Between**

- **Onsective Inc.** ("Processor", "Onsective"), [registered address], Canada
- **[Firm legal name]** ("Controller", "Firm"), [Firm address]

This DPA forms part of the Terms of Service between the parties governing the Firm's subscription to OnsecBoad. It applies whenever Onsective processes personal information on the Firm's behalf.

## 1. Definitions

- **Personal information ("PI")** has the meaning given in PIPEDA s. 2(1).
- **Processing** means any operation performed on PI, including collection, storage, retrieval, use, disclosure, deletion.
- **Sub-processor** means any third party that Onsective engages to process PI in the course of providing OnsecBoad. The current list is at Schedule 2.
- **Data subject** means an identified or identifiable natural person whose PI is being processed — typically the Firm's clients.

## 2. Roles + scope

The Firm is the **data controller** of all PI it uploads or causes to be uploaded into OnsecBoad. Onsective is the **data processor** acting on the Firm's instructions.

The categories of PI and the categories of data subjects are described in Schedule 1.

## 3. Onsective's obligations

Onsective will:

3.1 Process PI only on documented instructions from the Firm, including with regard to international transfers, unless Canadian law requires otherwise (in which case Onsective will inform the Firm before processing, unless the law prohibits the disclosure on important grounds of public interest).

3.2 Ensure that personnel authorized to process PI have committed themselves to confidentiality.

3.3 Implement appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including those listed in Schedule 3.

3.4 Engage sub-processors only with the Firm's general written authorization. Onsective will give 30 days' notice (via email to the firm-admin contact) before adding a new sub-processor; the Firm may object on reasonable grounds within those 30 days, in which case the parties will discuss alternatives in good faith.

3.5 Assist the Firm by appropriate technical and organizational measures with the fulfilment of the Firm's obligations to respond to data subject requests (right to access, correction, withdrawal of consent, erasure).

3.6 Make available to the Firm all information necessary to demonstrate compliance with this DPA and allow for and contribute to audits, including inspections, conducted by the Firm or another auditor mandated by the Firm. Audits may take place no more than once per calendar year, with reasonable notice, during business hours, and subject to confidentiality and reasonable cost reimbursement.

3.7 At the choice of the Firm, delete or return all PI to the Firm after the end of the provision of services, and delete existing copies, unless Canadian law requires storage. See Terms of Service § 5.4 for the default schedule.

3.8 Inform the Firm without undue delay of any breach affecting the Firm's PI. "Without undue delay" means within 24 hours of Onsective becoming aware of the breach.

## 4. Firm's obligations

The Firm warrants that:

4.1 It has obtained all consents required under PIPEDA, CASL, and applicable provincial law to upload its clients' PI to OnsecBoad and to instruct Onsective to process it.

4.2 It will provide Onsective with the lawful instructions necessary for processing.

4.3 It will respond to data subject requests directed to the Firm; Onsective will route any data-subject inquiry it receives directly to the Firm within 5 business days.

4.4 Its own privacy policy discloses Onsective as a processor.

## 5. Sub-processors

The Firm authorizes Onsective to engage the sub-processors listed in Schedule 2. New sub-processors are added per § 3.4.

Each sub-processor is bound by data protection terms substantially equivalent to those in this DPA.

## 6. International transfers

PI may be transferred to and processed in jurisdictions outside Canada in connection with sub-processors listed in Schedule 2. Onsective ensures that each transfer is supported by an appropriate transfer mechanism (e.g., the sub-processor's adherence to APEC Cross-Border Privacy Rules where applicable, or contractual safeguards).

## 7. Term

This DPA enters into force on the Subscription Effective Date and continues for as long as Onsective processes PI on the Firm's behalf.

## 8. Liability

Liability under this DPA is subject to the limit of liability in the Terms of Service, except that the cap does not apply to breaches of confidentiality or breaches of § 3.1 (acting outside instructions).

## 9. Governing law

This DPA is governed by the laws of Ontario, Canada, consistent with the Terms of Service.

## Signatures

- **Onsective Inc.** — [name, title, date, signature]
- **[Firm]** — [name, title, date, signature]

---

## Schedule 1 — Categories of PI processed

**Categories of data subjects**:
- Clients of the Firm (immigration applicants and their family members)
- Leads (prospective clients of the Firm)
- The Firm's staff users (employees / contractors of the Firm)

**Categories of PI**:
- Identification: name, date of birth, passport number, citizenship, government-issued ID
- Contact: email, phone, postal address
- Application content: travel history, employment history, education, family details, financial details, language test scores
- Financial: payment card details (handled by Stripe; tokenised), invoice + payment history
- Communications: SMS, email, in-portal messages between Firm and client
- Documents: passport scans, photos, transcripts, employer letters, financial statements, marriage / birth certificates as applicable
- Authentication: hashed passwords, TOTP secrets, passkey public keys, push notification tokens

**Sensitive categories** under PIPEDA's "sensitivity" assessment:
- Government-issued ID
- Financial details
- Family relationships and dependents
- Travel history (in conjunction with citizenship)

## Schedule 2 — Sub-processors

See `sub-processors.md` (live list, updated as vendors change). Effective version at the date this DPA is signed:

| Sub-processor | Role | Region |
|---|---|---|
| Cloudflare, Inc. | Document storage (R2), CDN | Canada (object storage) + global edge |
| Hostinger International Ltd. | VPS hosting | Canada region |
| Stripe, Inc. | Payment processing, billing | United States |
| Twilio, Inc. | Voice + SMS | United States |
| Anthropic PBC | AI extraction / classification / agent | United States |
| Expo, Inc. | Mobile push notifications | United States |
| Meta Platforms, Inc. | Lead ingestion (when firm enables) | United States |
| TikTok Inc. | Lead ingestion (when firm enables) | United States |

## Schedule 3 — Technical + organizational measures

**Pseudonymization + encryption**:
- All PI encrypted in transit (TLS 1.2+).
- Postgres backups encrypted at rest with AES-256-CBC and PBKDF2-derived keys.
- R2 documents encrypted at rest by Cloudflare's default encryption.

**Confidentiality, integrity, availability**:
- Multi-tenant database with row-level security for tenant isolation.
- Role-based access control with least-privilege defaults.
- Mandatory 2FA for all firm staff users.
- Audit log of every state-changing mutation, retained 7 years.
- Backups daily, off-site, in a separate region from primary storage.
- Monitored health endpoints (`/api/health/full`).

**Resilience**:
- Automated daily backups with quarterly restore drills.
- Documented restore procedure with RTO ≤ 60 min and RPO ≤ 24 hr (improving to 5 min when WAL archiving lands).

**Incident response**:
- Documented runbooks: incident, breach, restore, failover.
- 24-hour breach notification commitment to the Firm.

**Personnel**:
- Personnel with PI access undergo confidentiality training and sign confidentiality agreements.
- Access reviews conducted annually.

**Vendor management**:
- All sub-processors are bound by data protection terms substantially equivalent to this DPA.
- Sub-processor list maintained at `infra/legal/sub-processors.md` (also published).

**Testing**:
- Quarterly restore drills.
- Annual penetration test (after first year of operation).
- Continuous dependency vulnerability scanning.
