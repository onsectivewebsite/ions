# Breach notification template — to affected individuals

> **DRAFT — review with privacy counsel before sending.**
>
> This template is for the **firm** to send to its **clients** (data subjects)
> after a real-risk-of-significant-harm breach involving their personal
> information held in OnsecBoad. The firm is the controller; its name appears
> as the sender.
>
> Procedure context: see `infra/runbooks/breach.md` (Onsective's breach
> response runbook). PIPEDA s. 10.1 requires notification "as soon as
> feasible after the organization determines that the breach has
> occurred." Counsel should validate every paragraph below before any
> letter goes out.

---

## Subject line options

- "Important security notice from {Firm name}"
- "Action required: incident affecting your file with {Firm name}"

(Don't use vague subjects like "Important update" — clients will treat them as marketing and miss the notice.)

## Letter body

> [DATE]
>
> Dear {Client first name},
>
> We are writing to inform you of a security incident affecting personal
> information our firm holds about you in connection with your immigration
> file. We take this seriously and want you to have the information you
> need to protect yourself.
>
> ## What happened
>
> On [DATE], [BRIEF FACTUAL DESCRIPTION — what happened, where, how
> discovered]. We detected the incident on [DATE OF DISCOVERY] and
> immediately took steps to contain it.
>
> ## What information was affected
>
> The following categories of your personal information may have been
> involved:
>
> - [List specifically — e.g. "Your full name, date of birth, and passport
>   number", "Your contact information (email and phone)", "Documents you
>   uploaded for your file (passport, education transcripts)"]
>
> [If applicable: "Your password and any payment-card details were NOT
> affected."]
>
> ## What we have done
>
> - Contained the incident immediately upon detection.
> - Engaged our service provider, Onsective Inc., to investigate and
>   remediate.
> - Reported the breach to the Office of the Privacy Commissioner of
>   Canada as required.
> - [Other steps specific to this incident — credential rotation, third-
>   party forensic review, etc.]
>
> ## What you can do
>
> Depending on the categories of information involved, we recommend you:
>
> - Be alert to phishing emails or calls referencing your immigration
>   matter.
> - If passport or identity-document numbers were affected, [follow IRCC
>   guidance on suspected document compromise / consider applying for a
>   replacement] — see https://www.canada.ca/en/immigration-refugees-
>   citizenship.html
> - [Other advice tailored to the affected categories.]
>
> ## How to reach us
>
> If you have questions about this incident or your file, contact us at:
>
> {Firm name}
> [Firm phone]
> [Firm email]
>
> Our service provider Onsective Inc. has additional information about
> the technical aspects of the incident; you may also reach their privacy
> officer at privacy@onsective.com.
>
> ## Your rights
>
> If you have concerns about how your personal information was handled,
> you may file a complaint with the Office of the Privacy Commissioner of
> Canada:
>
> https://www.priv.gc.ca/en/report-a-concern/
>
> [Quebec residents: also Commission d'accès à l'information du Québec —
> https://www.cai.gouv.qc.ca]
>
> We are very sorry that this happened. We are committed to protecting
> your information and have taken steps to prevent recurrence.
>
> Sincerely,
>
> {Firm-admin name}
> {Firm name}
>
> ---
>
> *This notice is being sent in compliance with section 10.1 of the
> Personal Information Protection and Electronic Documents Act (PIPEDA)
> and applicable provincial privacy laws.*

## Operational notes

- **Send method**: email is acceptable for notification under PIPEDA when
  email is the firm's normal channel of communication with the client.
  For high-sensitivity breaches (passport / ID compromise) consider also
  posting via registered mail.
- **Timing**: as soon as feasible after determining the breach occurred.
  PIPEDA does not specify a maximum window like GDPR's 72 hours; in
  practice, 7 days from discovery is the floor for "as soon as feasible"
  with a defensible operational rationale.
- **OPC report**: must be filed concurrently with — or before — individual
  notification (s. 10.1(3)).
- **Records**: keep a copy in `infra/runbooks/incidents/YYYY-MM-DD-
  breach.md` per s. 10.3 (24-month retention obligation, even for
  non-notifiable breaches).
- **Suppression list**: when a breach involves a leaked email/phone list,
  bulk-add the affected channels to the firm's `SuppressionEntry` list
  to prevent inadvertent further marketing communications. See
  `apps/api/src/routers/suppression.ts`.
