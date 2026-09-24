# Pachi — Interaction and Moderation Rules

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and boundaries

Implements [product specification](../00-product/product-specification.md). Use [domain model](domain-model.md), [permissions](roles-and-permissions.md), [lifecycle states](lifecycle-states.md) and [review policy](review-system.md) together. Core text messaging, structured viewing, bilateral reviews, reporting/blocking and appeals are required MVP behavior.

## Contact, conversation and messages

An eligible phone-verified user contacting a discoverable listing creates or reuses one OPEN Interaction for seeker/provider-account/listing and its Conversation. Prevent contacts to oneself or one's represented organization. Server resolves listing context; a caller cannot substitute a different provider. Native call intent uses the same interaction context and does not establish attendance or successful connection.

Only the seeker, current scoped provider participants and explicitly authorized safety investigators can access private messages. For organizations, OWNER/ADMIN/LISTING_MANAGER need operational scope/delegation, and AGENT needs assignment. Membership removal ends access immediately. Staff support cannot browse conversations merely to answer an unrelated ticket.

Text messages support send, durable server acknowledgement, pagination, delivery/read state and transactional notification. Sender/client-message ID deduplicates retries. “Sent” means persisted; “delivered” means an authenticated recipient client acknowledged receipt; “read” means recipient opened/read according to explicit UI event. Push-provider acceptance is none of these. Order by server sequence/timestamp and stable tie-breaker; use cursor pagination.

Initial text limit 4,000 Unicode characters; enforce server length, abuse/rate limits and safe rendering. URLs remain untrusted. Blocked/restricted/suspended actors cannot send; do not allow arbitrary HTML/script rendering. Message attachments and voice are early releases behind media/abuse gates, not replacements for core text.

Offline clients may retain an unsent draft or clearly marked pending attempt; they must not show sent/delivered until the API confirms persistence. A retry rechecks current blocks/state, not the permissions at composition time. Do not cache private messages in the public saved-listing offline store.

## Viewing request and scheduling

Request requires an OPEN eligible Interaction, discoverable/available listing, permitted seeker and provider context, no block or relevant restriction. Store a proposed future time range and timezone; default display timezone Africa/Douala, store UTC. Request expires after 48 hours or the proposed start, whichever comes first. Provider acceptance before deadline enters ACCEPTED. Both parties confirming the actual time and safe meeting instructions enters SCHEDULED.

At most one active appointment (REQUESTED/ACCEPTED/SCHEDULED/RESCHEDULED/DISPUTED) per interaction. A declined/expired/cancelled appointment permits a new request if current policy permits. Prevent overlapping claims by checking schedule_version.

Exact private meeting instructions are visible only after SCHEDULED to currently authorized participants; they are never in public listing responses, push previews, product analytics or offline public cache. Providers should offer safe meeting guidance. Cancellation/removal ends future instruction access when it is no longer necessary; retain protected case access.

Either side may propose rescheduling. Existing schedule stays authoritative until both accept the replacement; increment schedule_version and retain prior schedule. Pending claims/reminders against the old version are cancelled. Send reminders 24 hours and 2 hours before appointment start when those times remain in the future; no retroactive reminder burst.

## Completion, attendance and no-show

| Event | Required rule |
|---|---|
| Completion claim | Either side after scheduled end. Record AttendanceClaim and durable counterparty notification; do not immediately set COMPLETED. |
| Counterparty confirms | Validate same viewing/schedule; set COMPLETED and create eligible review slots atomically. |
| No response | After 48 hours from durable notice availability, finalize uncontested claim if neither dispute nor restriction prevents it. External push/SMS failure alone does not block an inbox-based notice. |
| Neither side claims | Remain without validated completion; no review eligibility. Reminder/escalation may request confirmation. |
| No-show claim | At least 30 minutes after scheduled start; record claimed side and allow confirmation/dispute. Finalize after confirmation or 48-hour uncontested notice window. |
| Competing claims/dispute | Set DISPUTED, freeze rating eligibility and no-show counters; open scoped moderation case. |
| Resolution | Record evidence, reason, reviewer, final attendance outcome and review effects. No blind overwrite of the earlier event. |

Claims require one coherent outcome per viewing/schedule. A provider cannot claim seeker no-show and immediate completion to create ratings. No-show contributes only after validation and never automatically creates a star rating. Notify both sides of finalization and appeal/report routes.

First validated completed viewing per interaction creates bilateral review eligibility. Later completed appointments in the same interaction retain history without additional rating slots. Dispute invalidation reverses eligibility/aggregate effects through durable actions. Staff may resolve attendance exceptionally only within an assigned case; they cannot fabricate a normal user confirmation.

## Cancellation, closure and blocks

Cancellation records actor side, reason, time, scheduled start and policy version; not an automatic punitive star rating. Cancellation after appointment start may trigger attendance review instead of blindly overwriting a submitted claim. Preserve notifications and history.

Listing closure/unavailability stops new contact and new viewing requests. Existing interactions retain participant history, safe cancellation, dispute and support access. A provider's verification loss does not erase an existing appointment; warn participants and restrict new actions according to the sanction. Severe safety action may cancel future appointments through an explicit audited system operation.

Blocking stops new messages/contact/viewing between the relevant parties. It does not delete evidence, silently validate a no-show, cancel a review window, or prevent reporting/appealing. Offer controlled cancellation and support paths without requiring direct messaging with the blocked party.

## Reports and moderation

Reports may target user, provider, organization, property, listing, message, interaction or review. Capture reporter, target, reason, safe optional details and evidence attachment through the private case path. Rate-limit duplicates without rejecting an urgent report solely because a previous report exists. Aggregate related reports into a case while retaining each reporter's privacy.

| Severity | Response |
|---|---|
| LOW | Normal queue, no automatic public sanction. |
| MEDIUM | Prioritized investigation and relevant evidence preservation. |
| HIGH | Queue-age alert at 4 hours; assigned staff may temporarily hide/restrict within authority. |
| CRITICAL | Immediate alert and protective action by authorized operator; activate incident process if systemic. |

Queues show age, severity, target, assignment, next action and due time. Listing/verification queue-age alert at 24 hours. These are internal operating targets; launch volume must fit actual coverage. The sole project owner must establish coverage/escalation before the live pilot rather than claim nonexistent staffing.

Actions include warning; listing hide/remove; review hold/hide/remove; temporary capability restriction; account/provider/organization suspension within elevated permission; verification/relationship revocation; attendance invalidation; evidence hold; and case resolution. Each action has immutable actor, target, case, reason, policy version, before/after, time and optional expiry. Reversal creates a linked action. Corrections never erase the original record.

No automated permanent ban based only on report count or an opaque risk score. Risk signals prioritize review. Urgent temporary protections may run under explicit versioned policy with an audit event and human review path. Paid promotion cannot bypass safety eligibility.

## Appeals and sole-operator review

Appeals are core MVP for moderation sanctions and verification rejection/revocation. Filing window is 30 days after durable decision notice. Link the appeal to the original action, collect a reason/new evidence, preserve the sanction while reviewed, then record UPHELD, OVERTURNED or PARTIALLY_UPHELD and any compensating actions. Notify the appellant with safe rationale.

Prefer a reviewer different from the original actor when one exists. With a sole operator, record `review_mode=SOLE_OPERATOR_RECONSIDERATION`, perform a fresh evidence review, and disclose that it is reconsideration rather than independent adjudication. The operator cannot decide a case about their own personal listing/account/organization; that case remains restricted until a nonconflicted reviewer exists or the affected participation is excluded. No invented second approver or shared staff credential.

## Audit, evidence and privacy

Case evidence uses private access controls and explicit retention/holds. Product analytics exclude message contents, private instructions, identity data, free-form case notes and reporter identities. Audit records preserve request correlation and state history; sensitive details remain in access-controlled evidence records, not generic logs.

User deletion/withdrawal requests remove permitted public/user-facing content while preserving specifically held evidence under the approved retention schedule. Holds have reason, owner and review date. Access to a case is assignment/purpose limited even for staff.

## Acceptance evidence

Verify interaction uniqueness, participant scope, revoked assignment, self-contact prevention, send idempotency, offline acknowledgement, call intent semantics, scheduling/version races, private instruction access, expiry, contested/uncontested completion, no-show separation, duplicate reviews, blocked-party safety flows, report abuse handling, immutable actions, sanctions/appeals and sole-operator conflict policy. Record scenarios as executable tests as the corresponding feature is built.
