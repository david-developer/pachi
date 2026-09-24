# Pachi — Lifecycle States

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and transition protocol

Implements [product specification](../00-product/product-specification.md). Use the exact state names below in contracts/migrations. [Permissions](roles-and-permissions.md) govern actors; [interaction rules](interaction-and-moderation-rules.md) govern attendance; [reviews](review-system.md) govern reveal.

Transitions are named domain commands, not generic PATCH state setters. Require expected version, policy checks, idempotency key when retriable, audit/event history, and outbox insertion in the same transaction. Reject unspecified transitions. A scheduled job rechecks state/version at execution. Revocation effects must affect reads immediately even if projection rebuilding is asynchronous.

## User, provider and organization

| Aggregate | States and transitions |
|---|---|
| User | PENDING_PHONE → ACTIVE after verified phone; ACTIVE ↔ LIMITED by restriction policy; eligible active/limited → SUSPENDED by authorized action; SUSPENDED → ACTIVE/LIMITED only by resolution; ACTIVE/LIMITED → DEACTIVATED voluntarily; DEACTIVATED → prior permitted state after checks; permitted nondeleted → DELETION_PENDING → DELETED after retention/deletion workflow. A pending deletion may be cancelled after secure reauthentication before execution. |
| ProviderProfile | DRAFT → PENDING_VERIFICATION → ACTIVE after accepted claim; PENDING_VERIFICATION → DRAFT on correction; ACTIVE ↔ RESTRICTED; active/restricted → SUSPENDED; SUSPENDED → ACTIVE/RESTRICTED after resolution; nonclosed → CLOSED by allowed closure. CLOSED is terminal for that profile episode; reopening requires explicit reviewed recovery preserving history. |
| Organization | DRAFT → ACTIVE after ownership/contact setup; ACTIVE ↔ RESTRICTED; active/restricted → SUSPENDED; SUSPENDED → ACTIVE/RESTRICTED after resolution; allowed nonclosed → CLOSED. ACTIVE alone does not grant publication: business verification remains separate. |
| Membership | INVITED → ACTIVE, DECLINED, EXPIRED or REVOKED; ACTIVE → SUSPENDED or REVOKED; SUSPENDED → ACTIVE or REVOKED. REVOKED/DECLINED/EXPIRED invitation episodes are terminal; rejoining creates a new episode under the same unique current-member rule. |

Permanent deletion means public/account access ends and retained references are pseudonymized according to policy; it does not blindly cascade-delete case or transaction history. Closure cannot erase another participant's interaction record.

## Property and relationship

Property states: ACTIVE, POSSIBLE_DUPLICATE, MERGED, ARCHIVED, REMOVED. ACTIVE ↔ POSSIBLE_DUPLICATE; either may be merged into a distinct canonical asset by authorized staff. MERGED cannot be publicly edited or form a cycle. ACTIVE/POSSIBLE_DUPLICATE → ARCHIVED; ARCHIVED → ACTIVE only after validation. Policy removal uses REMOVED; restoration requires a new linked moderation decision.

ProviderPropertyRelationship authorization states: DECLARED, PENDING, VERIFIED, REJECTED, EXPIRED, REVOKED. Declaration creates DECLARED. Evidence submission may display PENDING while preserving a valid declaration; approval → VERIFIED; negative decision → REJECTED; elapsed validity → EXPIRED; withdrawn authority → REVOKED. New declaration/evidence after an adverse outcome requires a case resolution; it cannot bypass a risk hold. Optional authority assurance expiry changes the live relationship projection from VERIFIED to DECLARED only if a still-valid declaration remains and no adverse case/hold exists; preserve the expired VerificationClaim. Expiry of the relationship authorization period itself sets EXPIRED and blocks publication. Revocation sets REVOKED and cannot automatically fall back to a declaration. These events are independent of provider identity; validity dates are always checked.

## Listing: three independent state axes

Do not implement a single combined listing state. `UNDER_MODERATION` and `CLOSED` from the pre-reconciliation package are not canonical listing enum values.

### Publication axis

| From | Command / destination | Required guard |
|---|---|---|
| DRAFT | submit → PENDING_REVIEW | Complete current revision, eligible submitter, matching principal/authority, enabled region, valid offering and processed approved media. |
| PENDING_REVIEW | request_changes → DRAFT | Moderator reason; moderation_status CHANGES_REQUIRED. |
| PENDING_REVIEW | reject → REJECTED | Moderator reason; moderation_status REJECTED. |
| PENDING_REVIEW | approve_and_publish → PUBLISHED | Approval of exact revision and all current publication checks. |
| REJECTED | revise → DRAFT or archive → ARCHIVED | Record remediation/version; no direct publish. |
| PUBLISHED | pause → PAUSED | Authorized provider or system loss of required eligibility. |
| PUBLISHED | expire → EXPIRED | Freshness deadline reached. |
| PUBLISHED/PAUSED/EXPIRED | archive → ARCHIVED | Authorized principal ends advertisement. |
| PUBLISHED/PAUSED/EXPIRED/PENDING_REVIEW | safety_hold → HIDDEN | Assigned staff action/case; provider cannot undo hold. |
| HIDDEN | restore → PUBLISHED/PAUSED/EXPIRED | Explicit case outcome plus current publication checks; choose nonpublic state if checks fail. |
| HIDDEN or other nonremoved state | remove → REMOVED | Scoped moderation decision with reason. |
| PAUSED | resume → PUBLISHED | All checks pass, current approval and freshness. |
| EXPIRED | renew → PUBLISHED or PENDING_REVIEW | New freshness confirmation; reuse approval only if material revision unchanged and no risk hold. |
| ARCHIVED | republish → DRAFT | Explicit new revision, current authority and re-review. |
| REMOVED | appeal_restore → DRAFT | Successful appeal recorded; never immediate unreviewed public restoration. |

Material changes to a published listing create a new revision and move it to PENDING_REVIEW; discovery is withheld until approved. Cosmetic typo corrections still retain history; fields classified material include price/terms, purpose, responsible provider, authority, physical specifications, media and location precision. A provider change creates a new listing under the new principal; it cannot transfer historic reviews or conversations.

### Moderation axis

NOT_REVIEWED → IN_REVIEW on submission; IN_REVIEW → APPROVED, CHANGES_REQUIRED, REJECTED or ESCALATED. CHANGES_REQUIRED/REJECTED → IN_REVIEW on corrected submission. APPROVED → IN_REVIEW/ESCALATED on material edit or case hold. ESCALATED → IN_REVIEW/APPROVED/CHANGES_REQUIRED/REJECTED/REMOVED by scoped resolution. Removal sets REMOVED. Successful appeal → IN_REVIEW, not silent approval.

### Market axis

| Purpose | States | Discoverable states |
|---|---|---|
| RENT | AVAILABLE, UNDER_OFFER, RENTED, TEMPORARILY_UNAVAILABLE | AVAILABLE, UNDER_OFFER (clearly labeled) |
| SALE | AVAILABLE, UNDER_OFFER, SOLD | AVAILABLE, UNDER_OFFER (clearly labeled) |
| SHORT_LET | AVAILABLE, PARTIALLY_BOOKED, UNAVAILABLE | AVAILABLE, PARTIALLY_BOOKED (informational, no booking guarantee) |

Providers may move among compatible market states with reason/history. Returning RENTED/SOLD to AVAILABLE requires freshness confirmation and publication reevaluation; new tenancy/sale advertising should use a new listing episode when terms or responsibility change.

Visibility requires PUBLISHED + APPROVED current revision + discoverable market state + unexpired freshness + enabled region + eligible principal/authority + no hold. Search, detail, counters, recommendations and caches must share that predicate. A stale public cache cannot override a safety removal.

## Verification

VerificationCase states: NOT_STARTED, PENDING, NEEDS_RESUBMISSION, VERIFIED, REJECTED, EXPIRED, REVOKED. NOT_STARTED is an empty/draft case, not a successful claim. Submission → PENDING; officer decision → VERIFIED/REJECTED/NEEDS_RESUBMISSION; correction → PENDING. VERIFIED → EXPIRED by time, REVOKED by authorized action. Renewal after expiry/rejection/revocation creates a new case referencing the earlier decision; never overwrites the historic case. Active evidence collection steps may be recorded as events without inventing another assurance level.

## Interaction and Viewing

Interaction states: OPEN, CLOSED, RESTRICTED. OPEN → CLOSED voluntarily or by policy; OPEN/CLOSED → RESTRICTED on safety hold; resolution restores prior permitted state. Closed history remains readable under scope. A later new inquiry may create a new OPEN interaction only when no existing OPEN interaction and no block/hold prevents it.

Viewing states: REQUESTED, ACCEPTED, SCHEDULED, RESCHEDULED, DECLINED, EXPIRED, CANCELLED_BY_SEEKER, CANCELLED_BY_PROVIDER, SEEKER_NO_SHOW, PROVIDER_NO_SHOW, COMPLETED, DISPUTED.

| From | To | Guard |
|---|---|---|
| REQUESTED | ACCEPTED | Authorized provider accepts before response deadline. |
| REQUESTED | DECLINED / EXPIRED | Provider declines / server deadline passes. |
| ACCEPTED | SCHEDULED | Both agree time range; safe instructions stored; appointment in future. |
| REQUESTED/ACCEPTED/SCHEDULED/RESCHEDULED | CANCELLED_BY_SEEKER or CANCELLED_BY_PROVIDER | Actual actor side; retain reason/timestamp and notify counterparty. |
| SCHEDULED | RESCHEDULED | Both accept new time; append previous schedule, increment schedule version. Unaccepted proposal does not replace confirmed appointment. |
| RESCHEDULED | SCHEDULED | System completes accepted schedule update atomically with history; no real-time IN_PROGRESS state. |
| SCHEDULED | COMPLETED | Attendance confirmation rule in interaction policy satisfied; pending single claim is not this transition. |
| SCHEDULED | SEEKER_NO_SHOW / PROVIDER_NO_SHOW | Validated no-show claim, not immediate accusation. |
| SCHEDULED/COMPLETED/SEEKER_NO_SHOW/PROVIDER_NO_SHOW | DISPUTED | Timely dispute or staff case; freeze related review eligibility and trust effects. |
| DISPUTED | COMPLETED / corresponding no-show / corresponding cancellation | Scoped resolution with evidence, reason and outcome; rebuild eligibility/trust effects idempotently. |

DECLINED, EXPIRED and cancellation are terminal appointment episodes; create a new Viewing for another attempt. A completed viewing cannot be rescheduled. Use the exact cancellation/no-show side, not ambiguous CANCELLED/NO_SHOW alone.

## Review and eligibility

Eligibility states OPEN, HELD, CONSUMED, EXPIRED, REVOKED. First validated completion per Interaction creates OPEN; dispute → HELD; submission → CONSUMED; elapsed unused window → EXPIRED; invalidation → REVOKED. Dispute resolution may reopen previously unused eligibility with at least 7 days remaining; a consumed eligibility never becomes a new review slot.

Review states SUBMITTED_HELD, PUBLISHED, UNDER_REVIEW, HIDDEN, REMOVED, WITHDRAWN. ELIGIBLE is a product journey state represented by ReviewEligibility, not an empty Review row. REPORTED is a report/event, not an automatic visibility transition. Draft text may remain client-local.

SUBMITTED_HELD → PUBLISHED when both eligible sides submit or the 14-day window closes, subject to safety eligibility checks. Author may edit only before reveal. SUBMITTED_HELD/PUBLISHED → UNDER_REVIEW on substantive case, → HIDDEN on interim restriction, → REMOVED on final action, → WITHDRAWN on author withdrawal. UNDER_REVIEW is excluded from public output/aggregates in this baseline. Resolution may restore SUBMITTED_HELD or PUBLISHED according to reveal eligibility; removal reversal requires a new decision. WITHDRAWN remains consumed and is not republished through a new submission.

## Reports, cases, appeals and media

Reports: SUBMITTED → TRIAGED → IN_REVIEW → RESOLVED/DISMISSED → CLOSED; active reports may ESCALATE, then return to IN_REVIEW. Case states OPEN → TRIAGED → UNDER_REVIEW ↔ ACTION_REQUIRED → RESOLVED → CLOSED; reopen with event/reason. Appeals: SUBMITTED → UNDER_REVIEW → UPHELD/OVERTURNED/PARTIALLY_UPHELD → CLOSED. An appeal alone changes no underlying sanction.

Media: UPLOAD_AUTHORIZED → UPLOADED_QUARANTINED → PROCESSING → READY or REJECTED; processing failure → FAILED_RETRYABLE then PROCESSING, bounded attempts. READY assets become publicly usable only with domain/content approval. Any eligible asset → DELETION_PENDING → DELETED after holds and retention checks. Private evidence never becomes public by reaching READY.

## Coupling and recovery

| Trigger | Required effect |
|---|---|
| Required provider/business claim expires | Immediately suppress dependent public listings; set PAUSED with system reason, notify remediation. Reverification does not auto-publish without all checks. |
| Required claim or relationship revoked | Immediately suppress; HIDDEN + ESCALATED, open/link case and reevaluate related permissions. |
| Optional authority badge expires while current declaration remains valid | Remove badge; no automatic suppression unless relationship validity/risk hold requires it. Never rewrite adverse authority status into declaration. |
| Membership revoked | Remove future access immediately; retain authored history and organization-owned reviews/listings. |
| Viewing invalidated | Revoke eligibility, hold/remove related review contribution through case outcome, preserve audit. |
| Listing unavailable/archived | No new contact/viewing; retain existing conversation and safe cancellation/dispute/history access. |
| Region disabled | Suppress new submissions/discovery per rollout control; preserve participant history and notify affected providers. |

Required tests include invalid transitions, races at expiry/reveal boundaries, stale workers, duplicate commands, revision approval mismatch and every cross-aggregate effect above.
