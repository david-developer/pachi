# Pachi — Review System

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and scope

Implements [product specification](../00-product/product-specification.md), [domain model](domain-model.md) and [interaction rules](interaction-and-moderation-rules.md). Core MVP has bilateral reviews after validated completed viewings: seeker → ProviderAccount and ProviderAccount → seeker. For an organization listing, the provider target/reviewer is the organization ProviderAccount, with the acting member recorded separately.

Property-specific and individual-agent star aggregates are deferred. Inquiry, message exchange, saved listing, call tap, cancelled/declined/expired viewing and no-show alone create no normal star-review eligibility. Reviews describe marketplace behavior, not a completed rental/purchase unless that future domain supplies its own validated event.

## Eligibility and duplicates

When a Viewing becomes validly COMPLETED, create two eligibility records atomically/idempotently. Each stores viewing/interaction, reviewer subject, target, direction, opens_at, closes_at, policy version and status. Each direction is unique for that event. The database must enforce one review per eligibility, not merely perform an application precheck.

Both participants must be eligible to act and the event must remain valid. A provider actor must currently control the individual principal or be an authorized assigned/delegated organization member. A second agent cannot consume another slot for the same organization. Membership loss retains historical authorship; an authorized successor can use the still-unused organization eligibility.

No self-review, review of an organization the seeker belonged to at interaction/completion, fabricated viewing, unrelated target or duplicate slot. Retain membership snapshots needed to enforce this without exposing them publicly. Suspicious patterns open moderation review; internal risk scores never become public reputation labels.

Repeated genuine viewings have separate histories. To prevent repeat appointments manufacturing reputation, only the first validated completed viewing in one Interaction opens normal review eligibility in MVP. Later appointments in that interaction do not create extra slots; a genuinely new interaction after closure is evaluated by policy and abuse controls.

## Rating and criteria

Rating is a required integer 1–5. Text is optional, maximum 2,000 Unicode characters. Structured criterion ratings are optional integers 1–5 and never substitute for the explicit overall rating.

| Subject | Criteria |
|---|---|
| Provider | Listing accuracy, communication, reliability, transparency, overall experience. |
| Seeker | Communication, reliability, appointment attendance, respectful conduct, overall interaction. |

Do not score protected traits, personal housing eligibility, legal identity or financial worth. Review UI explains the limited experience being rated. No-show history is a separate validated operational measure, not an automatic one-star rating.

## Double-blind reveal

1. Eligibility opens on validated completion and closes 14 days later, using server UTC time and stored policy version.
2. Submission creates SUBMITTED_HELD. Only its author and explicitly authorized safety staff can read its contents while held.
3. Reveal both reviews when both eligible directions have a submitted review, or reveal the submitted eligible review(s) when the window closes.
4. Before revealing, recheck event validity, disputes, restrictions and moderation holds. Reveal transaction and aggregate updates must be race-safe and idempotent.
5. The counterparty cannot inspect held rating/text through API, notifications, exports, analytics, aggregates, search indexes or staff-like client projections. Reminders must not reveal the other party's submission status before reveal.

If one author withdraws before reveal, their consumed slot remains unavailable; the counterpart's review stays held until the normal deadline unless it has already been legitimately revealed. A hold on one review cannot expose it through reciprocal reveal. Do not reveal the other side early solely because a hidden/moderated submission exists; the ordinary deadline remains the safe fallback.

## Editing, withdrawal and disputes

Authors may edit rating/text while SUBMITTED_HELD before reveal, with immutable revision history. After reveal, rating/text are locked. An author may withdraw at any time; set WITHDRAWN, remove aggregate contribution and retain permitted audit/evidence. Withdrawal never opens a replacement slot or lets another organization member resubmit.

An attendance dispute holds unused eligibility and suppresses any related published review from public aggregates while evaluated. If completion is upheld, restore lawful publication or reopen unused eligibility with at least 7 days remaining; keep the original record and update the deadline with a policy event. If invalidated, revoke eligibility and remove its contribution through a linked decision. Later successful appeals do not produce duplicate records.

Late safety reports remain possible after the ordinary review/edit window. Expiry of an edit window does not prevent reporting abuse.

## Moderation and reports

User reports create a Report and may link to a ModerationCase. A report alone does not hide a review. A scoped moderator can set UNDER_REVIEW/HIDDEN during investigation; this baseline excludes both from public output and aggregates. Final actions include restore, warning, redaction-request to author before reveal, removal or account restriction. Moderators do not silently rewrite rating/text.

Prohibited content includes harassment, discrimination, threats, private addresses/contact data, identity documents, extortion, impersonation and irrelevant personal allegations. Preserve evidence and a reason-coded action; communicate an actionable reason without exposing confidential reporter information. Appeal availability follows the 30-day decision-notice window.

Only SUBMITTED_HELD and PUBLISHED reviews can return from a resolved temporary moderation state as permitted by their eligibility/reveal status. WITHDRAWN remains withdrawn. Removal reversal is a new decision with eligibility rechecked; no unconditional state restoration.

## Aggregates and presentation

Only eligible PUBLISHED reviews contribute. Compute count and sum, derive average; exclude UNDER_REVIEW, HIDDEN, REMOVED, WITHDRAWN and invalidated events. Show the published review count at any size; display numeric aggregate only at 3 or more eligible published reviews. Individual published reviews may be visible below that threshold. Provider and seeker reputation are separate subjects/directions.

Public presentation shows approved display name, role context, coarse review date, rating/text, relevant verification claim and eligible-event label. It never shows private phone, exact appointment instructions or legal identity. Do not imply a property was rented, sold or legally verified because a viewing review exists.

Aggregate updates use durable events and idempotent projection rebuilds. Read filtering immediately excludes invalid content even if an aggregate recalculation job is delayed; public numeric aggregates must not continue counting a suppressed review. Prefer transactionally maintained eligible counts for initial scale and periodic source reconciliation.

## Notifications and analytics

Emit review_eligibility_created, review_submitted, review_published, review_reported, review_withdrawn and review_moderation_changed with event ID, subject type/direction, viewing/interaction references, policy version and safe reason category. Do not send text, exact appointment time, counterpart held status or evidence into analytics.

Notify eligibility opening, reminder 3 days and 1 day before expiry, reveal and moderation/appeal outcomes. Suppress reminders for consumed/revoked eligibility and expired endpoints. External notification failure does not mutate eligibility or publish content prematurely.

## Acceptance evidence

Verify bilateral eligibility, first-viewing-only rule, organization duplicate prevention, outsider/self-review denial, exact time-boundary behavior, simultaneous submissions/reveal, editing locks, withheld API/notification/export fields, review withdrawal, dispute hold/restore, removed-review aggregate correction and safe appeal handling. UI-only tests do not establish double-blind privacy.
