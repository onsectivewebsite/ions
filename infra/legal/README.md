# Legal templates

> **DRAFT — review with privacy counsel before any external use.**

This directory holds Onsective Inc.'s legal scaffolds for OnsecBoad:

| File | Purpose | Audience |
|---|---|---|
| `privacy-policy.md` | What Onsective collects from firm admins / billing contacts / marketing-site visitors | Public — published at onsective.cloud/privacy |
| `terms-of-service.md` | Master agreement between Onsective and each subscribing firm | Each firm — accepted on `/setup` |
| `dpa-template.md` | Data Processing Agreement (Onsective = processor, firm = controller) | Firms that ask for one |
| `sub-processors.md` | Vendors Onsective uses to deliver the service | Public — included with DPA |
| `breach-notification-individual.md` | Template letter the firm sends to its affected clients | Internal — used during a breach |

## What these are NOT

- **Not legal advice.** Every document needs counsel review before it touches a real customer or regulator.
- **Not a substitute for the firm's own privacy policy.** Each subscribing firm has its own data subjects (their clients) and their own obligations under PIPEDA + provincial law. Their policy must disclose Onsective as a processor.
- **Not jurisdiction-portable.** These are written for Canadian PIPEDA + CASL with notes for Quebec Law 25 callouts. US (CCPA/CPRA), EU (GDPR), and UK (UK GDPR) require their own counsel-reviewed adaptations.

## Roles

```
Data subject:  Client of a law firm using OnsecBoad
                          ▼ (PI flows through OnsecBoad)
Controller:    Law firm (subscriber)
                          ▼ (engages as data processor)
Processor:     Onsective Inc. (vendor of OnsecBoad)
                          ▼ (engages sub-processors)
Sub-processor: Cloudflare R2, Stripe, Twilio, Anthropic, Hostinger, Expo, …
```

The firm and its clients sign nothing with Onsective directly. Their data lands with us by virtue of the firm's subscription. PIPEDA's accountability principle means the firm bears responsibility to its clients, AND Onsective bears responsibility to the firm under the DPA.

## Update protocol

Treat these like code: every change goes through review + sign-off (preferably from counsel). Tag the file in `infra/legal/CHANGELOG.md` (TBD) when you update — counsel will want a version history.
