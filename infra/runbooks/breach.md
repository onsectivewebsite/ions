# Breach runbook (PIPEDA, CASL)

> What to do in the first 72 hours of suspecting unauthorized access to or loss of personal information.

**Legal context**: PIPEDA's Mandatory Breach of Security Safeguards regulations require notification to (a) the Office of the Privacy Commissioner of Canada (OPC) and (b) affected individuals if a breach poses a "real risk of significant harm" (RROSH). The 72-hour window starts when the firm (Onsective Inc., as the processor) becomes aware of the breach.

**This runbook is operational, not legal advice.** Engage privacy counsel immediately when a SEV-1 incident may involve PII exposure. Counsel's interpretation of RROSH supersedes anything here.

## Eligibility test (RROSH)

Per s.10.1 PIPEDA, a "real risk of significant harm" assessment considers:

1. **Sensitivity** of the personal information involved (passport scans, IELTS scores, financial info → high sensitivity by default for our vertical).
2. **Probability** the information has been or will be misused (was it actually accessed? was it published? has it been deleted?).
3. **Other relevant factors** (volume, identifiable individuals, jurisdictions).

Document the assessment in writing the same day, even when concluding NO notification is needed.

## First 4 hours — contain + preserve

1. **Stop the bleed**: revoke compromised credentials, kill suspect sessions, isolate the affected system.
   ```sh
   # Revoke every active staff session for a tenant:
   psql ... -c "DELETE FROM \"Session\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"tenantId\" = '<id>');"
   # Suspend a tenant entirely:
   psql ... -c "UPDATE \"Tenant\" SET status='SUSPENDED' WHERE id='<id>';"
   ```
2. **Preserve evidence**: snapshot logs, audit table, R2 access logs (Cloudflare provides these), Stripe + Twilio activity. Don't `rm -rf` anything in the affected paths.
3. **Document the scope** in a SCRATCH document: what data, what tenants/clients, how was it accessed, when.

## First 24 hours — assess + escalate

1. **Engage counsel** + privacy officer (Rishabh, in current org).
2. **Run the `dataRights.exportClient`** procedure for every affected client (same export the right-to-access flow uses). Saves these to a sealed location for forensic + notification use.
3. **Check the `AuditLog`** for the scope of access:
   ```sql
   SELECT "actorId", "actorType", "action", "createdAt", "ip", "payload"
   FROM "AuditLog"
   WHERE "tenantId" = '<id>'
     AND "createdAt" BETWEEN '<start>' AND '<end>'
   ORDER BY "createdAt" ASC;
   ```
4. **Identify exposed individuals**: clients (PII), leads (PII), users (credentials).
5. **Snapshot a list** of contact info for notification: from `Client.email`, `Client.phone` (if SMS notification is appropriate), `User.email`.

## Within 72 hours — notification

If the assessment concludes RROSH applies, three notifications are required:

### 1. OPC notification

Use the OPC's online breach reporting form: https://www.priv.gc.ca/en/report-a-concern/report-a-privacy-breach-at-your-business/

Required content (PIPEDA Schedule):
- Description of the breach
- Date / time period
- Nature of personal information involved
- Number of affected individuals
- Steps taken / planned to reduce risk
- Notification status to individuals
- Contact information for OPC follow-up

### 2. Affected individuals

Notification must contain:
- Description of the breach
- Date / time period
- Nature of PI involved (specifically what was exposed)
- Steps the individual can take to mitigate harm (change passwords, monitor credit, etc)
- Steps the firm + Onsective have taken
- Contact info for follow-up
- A reference to the OPC for further questions

Email template at `infra/runbooks/templates/breach-notification-individual.md` (TBD — fill from your privacy counsel's draft when they provide one).

### 3. Onsective Inc.'s internal record

Section 10.3 PIPEDA requires a record of every breach (notifiable or not) for 24 months, available to the OPC on request. Stash in `infra/runbooks/incidents/YYYY-MM-DD-breach.md` with:
- Eligibility test outcome (notify? rationale?)
- Scope: tenants, clients, users, PI types
- Detection method + timestamp
- Containment timeline
- Notifications sent (OPC, individuals)
- Remediation taken
- Lessons learned

## After

- **Suppress** the affected channels if relevant (CASL; bulk add to `SuppressionEntry` if a leaked email/phone list is now treated as DNC by default).
- **Rotate every secret** that touched the affected path: API keys, JWT signing keys, Stripe / Twilio / Anthropic keys, R2 credentials.
- **Notify CSPs** of any compromise affecting their service: Stripe, Cloudflare, Twilio. They may have additional reporting obligations.
- **Schedule a 30-day post-incident audit** to verify no residual exposure and update this runbook based on what you learned.

## Related procedures

- `restore.md` — if data was lost (vs. exposed), restore from latest backup before notifying.
- `incident.md` — for the operational response (separate from the privacy / legal track).
