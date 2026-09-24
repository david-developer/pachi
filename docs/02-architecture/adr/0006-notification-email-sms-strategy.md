# ADR 0006 — Notifications, Email, SMS and Push

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Decision

Pachi owns notification intent, preferences, inbox and delivery history. Initial providers: Amazon SES for transactional email, AWS End User Messaging SMS as the Cameroon SMS candidate, Expo Push Service for native push, PostgreSQL/API for in-app inbox. Web push is deferred. Provider selection never changes authentication/verification or domain completion semantics.

Cameroon sender requirements, delivery quality, consent wording and cost must pass E02 before real SMS. There is no assumed successful benchmark and no configured fallback vendor until validated. If primary SMS fails, keep retries bounded and tell users safely; do not route their numbers through an unapproved fallback. OTP redemption remains the proof of phone control.

## Service boundaries

Domain transaction emits safe OutboxEvent → notification service creates Notification and channel delivery records → SQS worker sends via EmailProvider/SmsProvider/PushProvider adapters → provider receipt/webhook updates delivery status. In-app intent persists even when external delivery fails. OTP challenge/send uses a dedicated high-priority path with short expiry and separate retry policy; it cannot wait behind bulk notification work.

Each logical delivery has a stable idempotency key from notification/recipient/channel/template version. Provider acceptance, device delivery, open and resource action are different facts. Unknown provider outcome requires reconciliation where supported, not an unconditional second send. At-least-once queues may duplicate or reorder messages; consumers must be idempotent and recheck current domain state.

## Events, channels and privacy

| Category | Core events / policy |
|---|---|
| Account/security | Phone challenge, recovery, contact change, session/security alert, restriction/appeal outcome. Mandatory notices cannot be disabled as marketing. |
| Verification | Submission, correction request, decision, expiry/revocation and appeal outcome. No document number/image or private evidence in payload. |
| Listings | Submission, changes required, publication, pause/hide/remove, freshness reminder and expiry. |
| Interactions | New text message, viewing request/acceptance/schedule/reschedule/cancellation, reminder, attendance confirmation and dispute. |
| Reviews | Eligibility, closing reminder, reveal and moderation outcome. No held review text/rating or counterpart submission status. |
| Discovery | Saved-search/price alerts are early-release features; explicit preference/frequency limits. |
| Marketing | Separate opt-in, unsubscribe/suppression and campaign limits; not a disguised mandatory transactional category. |

Push/lock-screen payloads contain minimal generic text and opaque safe resource reference. Never include message body, private address, viewing directions, identity data or moderation evidence. Opening any notification reauthorizes against current server state; a deep link is not a capability token.

## Preferences, localization and scheduling

Store per-user category/channel preferences and consent history/version. Defaults: required security notices enabled; ordinary transactional inbox enabled; email for verification/critical account outcomes enabled; mobile push only after permission; ordinary SMS off except OTP/security escalation allowed by policy; marketing off. Users may disable optional channels without losing security/recovery access.

Templates use versioned English/French keys and safe variable schemas. Locale uses user preference then documented fallback. UTC storage, Africa/Douala appointment display by default; reminders show clear local time. Quiet hours default 22:00–07:00 user-local for nonurgent external notifications; explicit OTP and urgent security notices bypass quiet hours. Timezone changes/reschedules replan queued reminders.

Due jobs are persisted in ScheduledAction, not process timers. Reminders recheck eligibility, current schedule/version, preference, recipient scope and destination before send. Review reminders never reveal that the other party submitted. Cancel jobs when appointments/eligibilities are no longer active.

## Email

SES domain identity, DNS ownership, SPF/DKIM/DMARC alignment, production access/quota and bounce/complaint webhooks are validated before sending real traffic. Cognito-managed sign-in verification/reset mail remains separate from ordinary notification mail. Pachi never generates Cognito reset codes itself.

Templates render accessible text and HTML, escape variables and use trusted links only. Suppress hard-bounced/complaining destinations, handle soft bounces with bounded retries, verify webhook/event provenance and dedupe event IDs. Delivery reputation/quotas have alerts; no indiscriminate tracking pixels in sensitive account messages. Unsubscribe/consent applies to marketing regardless of provider.

## SMS and OTP

Use the phone challenge limits/purpose binding in [verification policy](../../01-domain/verification-model.md). Normalize E.164, restrict enabled destination markets, set provider/account spend alarms and application hard caps. Monitor send/accept/delivery/OTP-redemption separately. Avoid logging full phone numbers or OTP codes; keep destination pseudonyms for abuse correlation under retention policy.

OTP text includes brand, code purpose and expiry, never a secret-bearing link to an arbitrary domain. Test English/French encoding, segment counts, delivery latency and duplicate behavior on actual Cameroon networks. An old OTP delivery arriving late does not restore an invalidated challenge. Challenge lifetime is not extended by queue retries.

## Push endpoints

Register authenticated user/device installation and push token; record locale/platform/consent. One token cannot remain associated with an old user after account switch. Logout, invalid-token receipt and permission revocation disable endpoint. Push tickets and receipts are processed, retried only for transient outcomes and deduplicated. App launch fetches authoritative unread inbox; successful push submission is not message delivery/read.

## Queue, retries and failure handling

Use SQS standard queues plus DLQs for notification workloads; separate OTP/security priority from ordinary notifications. Start transient retries at 30 seconds, 2 minutes, 10 minutes, 30 minutes and 2 hours with jitter and maximum 5 attempts, bounded by the message's usefulness/expiry. Never retry expired OTPs or past appointment reminders. Permanent invalid destination/payload errors stop immediately and update destination status. Rate-limited sends respect provider retry guidance and account limits.

Visibility timeout must cover processing, with bounded heartbeat for long work. Delete message only after durable result. Consumer receipt uniqueness prevents repeated database effects; provider idempotency and ambiguous-send reconciliation limit duplicate external messages. DLQ replay is supervised, current-state checked, rate-limited and audited.

Reference mechanics: [SQS at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html) and [visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html). Retry schedules above are Pachi defaults, not vendor guarantees.

## Observability, testing and cost

Measure generated, queued, provider-accepted, delivered where confirmed, failed, suppressed, opened and acted-upon distinctly. Monitor oldest message age, DLQ, bounce/complaint rate, invalid push tokens, SMS spend, OTP redemption latency and notification duplicates. Product analytics receives safe event metadata, never destination/contact values, message/evidence content or held reviews.

Local environments use sinks/emulators and synthetic destinations; staging uses allowlisted test recipients and explicit opt-in. No unrestricted production address-book replay. Demonstrate preferences, quiet hours, language fallback, deep-link authorization, endpoint reassignment, provider outage, bounce/complaint handling, idempotent replay, expiry and cost caps before live release.
