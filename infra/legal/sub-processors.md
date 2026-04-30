# Sub-processors

> **DRAFT — verify each entry against the live integration before publishing.**
> Last updated: [DATE]

This is the current list of vendors Onsective engages to process personal information on behalf of subscribing law firms. It is published at onsective.cloud/sub-processors and forms Schedule 2 of every executed DPA.

We give 30 days' written notice via firm-admin email before adding a new sub-processor; firms may object on reasonable grounds.

## Active

| Sub-processor | Role | Data processed | Region | Privacy URL |
|---|---|---|---|---|
| **Cloudflare, Inc.** | Object storage (R2) for client documents + invoice PDFs + AI-generated PDFs + backups | Document files, invoice PDFs, encrypted DB backups | Canadian region for primary R2; global edge CDN | https://www.cloudflare.com/privacypolicy/ |
| **Hostinger International Ltd.** | VPS hosting for the API + web applications | All firm + client data while in use by the running application | Canadian region | https://www.hostinger.com/privacy-policy |
| **Stripe, Inc.** | Subscription billing + payment processing | Payment card details (tokenised), billing address, transaction history | United States | https://stripe.com/privacy |
| **Twilio, Inc.** | Voice calls + SMS | Phone numbers, call recordings (when enabled), SMS content | United States | https://www.twilio.com/legal/privacy |
| **Anthropic, PBC** | AI extraction, classification, agent, summarization (Claude API) | Document content, intake form values, message text, transcripts (call summary) | United States | https://www.anthropic.com/legal/privacy |
| **Expo, Inc.** | Mobile push notification delivery | Device push tokens + notification payload | United States | https://expo.dev/privacy |
| **Hostinger Email** | Transactional email (OTP, invites, notifications) | Email addresses + email content | Canada | https://www.hostinger.com/privacy-policy |

## Conditionally engaged (firm opt-in)

These sub-processors are engaged only when a firm enables the corresponding feature in their workspace:

| Sub-processor | Feature | When engaged |
|---|---|---|
| **Meta Platforms, Inc.** | Lead Ads webhook | Firm configures Meta Lead Ads in Settings → Integrations |
| **TikTok Inc.** | Lead Gen webhook | Firm configures TikTok in Settings → Integrations |

## Not engaged (despite presence in tooling)

For transparency, the following are NOT in the live data plane:

- OpenAI / GoogleAI — Onsective uses Anthropic exclusively for AI features; no other LLM provider receives firm data.
- Google Analytics, Meta Pixel, advertising trackers — onsective.cloud uses first-party privacy-preserving analytics.
- Any third-party CRM or e-mail-marketing system — all marketing communications send from our own infrastructure.

## Change history

| Date | Change |
|---|---|
| [date of first DPA] | Initial list published |
