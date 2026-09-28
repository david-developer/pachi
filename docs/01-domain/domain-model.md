# Pachi — Domain Model

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and conventions

Implements [Product Specification V2.1](../00-product/product-specification.md). [Lifecycle states](lifecycle-states.md), [permissions](roles-and-permissions.md), [verification](verification-model.md), [reviews](review-system.md) and [interaction/moderation rules](interaction-and-moderation-rules.md) elaborate this model without overriding product behavior. Architecture and persistence choices must preserve these invariants.

All primary IDs are immutable application-owned UUIDs. Store timestamps in UTC and include `created_at`, `updated_at` and a concurrency `version` on mutable aggregates. Public display names are separate from legal identity. Financial amounts are integer minor units plus ISO currency; XAF has no fractional minor unit in the initial product. Use currency-aware formatting; never store formatted price strings or floating-point money. No provider SDK identifier is a domain primary key.

## Identity and principals

| Entity | Required relationships and fields | Invariants |
|---|---|---|
| User | id, account_state, display_name, preferred_locale, home_region_id, home_city_id, security_version | One account may seek, provide and belong to multiple organizations. State never substitutes for verification. |
| AuthIdentity | user_id, issuer, subject, provider, linked_at, unlinked_at | Unique active issuer/subject. Never auto-link by equal email. |
| PhoneContact | user_id, normalized_e164, verified_at, verification_version, replaced_at | One active verified number cannot belong to two accounts. Phone change requires fresh verification and security checks. |
| EmailContact | user_id, normalized_email, verified_at, delivery_state | Authentication verification and delivery suppression are separate. |
| SecuritySession | user_id, issuer, app_client_id, origin_jti, device_label, authenticated_at, last_seen_at, expires_at, revoked_at | Server ties JWT token family to registered session; current account and session state enforced. Tokens/secrets never appear in API projections. |
| ProviderProfile | user_id, provider_types, provider_state, public_profile | At most one individual profile per user; supported types OWNER, INDEPENDENT_AGENT, PROPERTY_MANAGER may coexist. Type proves no property authority. |
| ProviderAccount | kind INDIVIDUAL or ORGANIZATION, provider_profile_id or organization_id, state | Exactly one subject reference, unique per subject. Every listing and provider reputation target uses this stable principal. |
| Organization | legal/public names separated, organization_type, state, public_contact | REAL_ESTATE_AGENCY, PROPERTY_MANAGEMENT_COMPANY, CORPORATE_PROPERTY_OWNER, OTHER_APPROVED_PROVIDER. Business verification separate. |
| OrganizationMembership | organization_id, user_id, role, state, inviter_id, invitation_expires_at, activated_at, revoked_at | One current membership per organization/user; memberships are many-to-many. At least one active OWNER unless organization is under explicit recovery. |
| ResourceAssignment | organization_id, membership_id, listing_id or interaction_id, assigned_by, valid_until | Referenced resource belongs to same organization; assignment cannot increase role permissions. |
| StaffGrant | user_id, role, permission_scope, active_from, expires_at, granted_by | Separate from organization roles. Cannot be edited by a normal profile endpoint. |
| CapabilityRestriction | subject_type/id, capability, reason_code, starts_at, ends_at, moderation_action_id | Narrow sanctions independent of account state; active restrictions checked at every affected operation. |

Keep responsible `provider_account_id` distinct from `actor_user_id`. An agent's action belongs to the organization principal but remains attributable to that agent. Membership removal does not reassign historic ownership.

## Geography, property and authority

| Entity | Fields and relationships | Invariants |
|---|---|---|
| Region / City / Neighborhood | stable IDs, localized names, aliases, parent IDs, publishing_enabled | City belongs to region; neighborhood belongs to city. Southwest/Littoral enabled initially; other regions preregistration only. |
| RegionInterest | user/contact consent reference, region_id, created_at | Preregistration is not permission to publish. Avoid exposing private location preferences. |
| Property | property_type, physical specifications, condition, amenities, record_state, canonical_property_id | Physical asset only: no asking price, listing copy, provider ownership assumption or publication state. |
| PropertyLocation | property_id, region_id, city_id, neighborhood_id, landmark, private_address, optional geography point, coordinate_source, precision | Canonical Pachi geography, user-confirmed coordinates. Separate public projection from private exact data. |
| ProviderPropertyRelationship | property_id, provider_account_id, relationship_type, authorization_status, declared_at, valid_from, valid_until, principal_reference, verification_id, risk_hold | Types OWNER, AUTHORIZED_AGENT, PROPERTY_MANAGER. Current declaration for every listing. VERIFIED badge only with current evidence-backed claim. |
| PropertyMerge | source_property_id, canonical_property_id, moderator_id, reason, case_id | No cycles; preserve listings, relationships, references and audit history. Restricted source data cannot become public through merge. |

`PropertyAuthority` in older documents means ProviderPropertyRelationship; do not create a competing authority aggregate. A risk hold records reason, reviewer and required remediation. An expired relationship cannot be made current by editing the client date. A pending evidence case does not invalidate a still-current declaration by itself.

## Listing and Offering

| Entity | Required fields | Invariants |
|---|---|---|
| Listing | property_id, provider_account_id, provider_property_relationship_id, purpose, title, description, publication_status, market_status, moderation_status, public_location_mode, current_revision_id, last_confirmed_at, expires_at | Purpose RENT, SALE, SHORT_LET. Relationship must match both property and provider principal. Publication checks run atomically. |
| ListingRevision | listing_id, version, material snapshot, created_by_user_id, reason, submitted_at, approved_at | Moderation approves an exact version; later edits cannot inherit its approval. Public responses use only approved permitted content. |
| Offering | listing_id, purpose, current_version_id | One logical offering per listing; publishable listing has exactly one active compatible version. Draft may be incomplete. Never embedded as unvalidated `offering_fields`. |
| OfferingVersion | offering_id, currency, amount_minor, pricing_period, negotiable, effective_from, effective_until, purpose-specific terms, author_id | Version history immutable. Exactly one current version; non-overlapping effective intervals. Material changes create revision and analytics event. |
| ListingMedia | listing_id, media_asset_id, display_order, is_cover | At least one approved processed image to submit/publish; association and resource ownership checked. |
| SavedListing | user_id, listing_id, saved_at | Unique user/listing; idempotent save/unsave. Saving does not preserve access to removed/private content. |
| SavedListingSnapshot | local-only listing/version, last_synced_at, allowed public projection, derivative cache refs | Mobile SQLite projection, bounded and purged on logout/account switch; never canonical inventory. |

| Purpose | Pricing and required commercial fields |
|---|---|
| RENT | MONTHLY rent, deposit amount, advance_months, minimum_lease_months, available_from, utility inclusion, service charge. Values may be zero where applicable, never negative. |
| SALE | TOTAL price, negotiable, available_from. |
| SHORT_LET | NIGHTLY rate, optional WEEKLY rate, minimum_nights, guest_limit, local check-in/check-out times, optional cleaning fee. Informational availability only; no booking/payment promise. |

Physical measurements have numeric values and units; distinguish unknown from zero. A schema migration and backend validation must prohibit rent-only fields in a sale offering. Price updates, authority/provider changes and location-precision changes require recorded revisions and moderation reevaluation.

## Communication and viewing

| Entity | Fields and relationships | Invariants |
|---|---|---|
| Interaction | listing_id, seeker_user_id, provider_account_id, state, initial_channel, opened_at, closed_at | One OPEN interaction per seeker/provider/listing. Listing context and provider cannot be swapped by payload. |
| InteractionParticipant | interaction_id, user_id, side, membership/assignment reference | Seeker plus currently authorized provider actors. Historic actor records do not grant future read access. |
| Conversation | interaction_id | One conversation per interaction; only scoped participants or purpose-authorized safety access. |
| Message | conversation_id, sender_id, client_message_id, body, sent_at, delivered_at/read receipts, visibility_state | Unique sender/client ID prevents retry duplicates. Safety retention may preserve removed-from-view content. |
| ContactIntent | interaction_id, actor_id, channel, occurred_at | Native call/contact tap is intent only, never evidence of call connection or viewing. |
| Viewing | interaction_id, state, proposed_start/end, scheduled_start/end, display_timezone, schedule_version, private_instructions, response_deadline | Child of Interaction, not an alternative Interaction type. One active appointment per interaction at a time. |
| ViewingEvent | viewing_id, sequence, type, actor_id, timestamp, prior/new state, schedule_version, reason | Append-only event history; includes rescheduling proposals, claims, confirmations and disputes. |
| AttendanceClaim | viewing_id, schedule_version, claim_type, claimant_side, claimed_at, notified_at, response_deadline, state | No unilateral immediate completion. A response deadline starts only when durable notice is available; external SMS/push delivery is not required. |
| Dispute | viewing_id or moderation_action_id, opener_id, reason, state, resolution_id | Open attendance dispute holds review eligibility and disputed trust counters. |
| NoShowEvent | viewing_id, responsible_side, validation_method, resolved_at, invalidated_at | Separate structured operational history; no normal star-review eligibility. |
| BlockRelationship | blocker_user_id, blocked_user_id/provider_account_id, created_at, revoked_at | Enforced server-side on contact, new viewing and messages; reports, appeals and safe cancellation remain available. |

Inquiry creates/reuses Interaction and Conversation. Viewing is a separate repeatable appointment history within that business context. Do not implement older `Interaction.type = INQUIRY/CONTACT_REQUEST/VIEWING` as three unrelated completion models.

## Reviews and trust

| Entity | Fields and relationships | Invariants |
|---|---|---|
| ReviewEligibility | viewing_id, interaction_id, reviewer_subject_type/id, target_type/id, direction, opens_at, closes_at, state, consumed_at, policy_version | Unique viewing/reviewer subject/target/direction. Provider reviewer subject is ProviderAccount, not arbitrary agent. |
| Review | eligibility_id, author_user_id, rating, optional text, state, submitted_at, published_at, withdrawn_at | Unique eligibility; integer rating 1–5; edits have version history. One organization review per direction regardless of number of agents. |
| ReviewRevision | review_id, version, rating/text, editor_id, edited_at | Preserve edits; held-only editing before reveal. |
| ReputationAggregate | subject_type/id, direction, eligible_count, rating_sum, refreshed_at | Derived solely from eligible PUBLISHED reviews; independent provider/seeker aggregates. |

The first validated completed viewing per Interaction opens two directional eligibilities; later appointments in that Interaction do not open new review slots. Enforce uniqueness on interaction/reviewer subject/target/direction as well as the viewing reference. Org membership loss does not change the review target or permit another review; an authorized replacement member may act for the same organization eligibility. No self-review, own-organization review, unrelated review, duplicate review or publication of held review contents to the counterparty.

## Verification and moderation

| Entity | Fields and relationships | Invariants |
|---|---|---|
| VerificationCase | subject_type/id, verification_type, state, applicant_id, reviewer_id, policy_version, submitted_at, decision_at, valid_until | Immutable decisions plus new cases for reverification; state machine in lifecycle document. |
| VerificationEvidence | case_id, media_asset_id, evidence_type, received_at, retention_policy_id, delete_after, legal_hold_id | Private classification; ordinary provider/listing APIs never return evidence keys or URLs. |
| VerificationClaim | subject_type/id, type, status, source_case_id, valid_from/until, revoked_at | Current read model of approved evidence-backed claim; unique active claim per subject/type. |
| Report | reporter_id, target_type/id, reason, severity, state, submitted_at, case_id | Many reports may link to one case. A report does not automatically establish guilt or remove content. |
| ModerationCase | category, target, severity, state, assigned_staff_id, opened_at, closed_at | Scoped staff access, queue age and escalation visible. |
| ModerationAction | case_id, target, actor_id, type, reason_code, policy_version, before/after, effective_until, created_at | Append-only. Reversal is a new linked action. |
| Appeal | original_action_id or verification_decision_id, applicant_id, reason, state, submitted_at, reviewer_id, outcome_action_id | Never erases original decision; 30-day filing window from notice. |
| EvidenceHold | case_id, object/reference, reason, created_by, expires_at, review_due_at | Prevent scheduled deletion while valid; scope and retention are auditable. |

## Media, notifications, jobs and events

| Entity | Minimum fields and rules |
|---|---|
| MediaAsset | owner principal, classification PUBLIC_MARKETPLACE/PRIVATE_EVIDENCE/MESSAGE_ATTACHMENT, storage reference, original hash, MIME, bytes, dimensions, lifecycle, derivative refs. Message attachments are reserved for the early-release feature gate. |
| Notification | recipient_user_id, category, event_id, safe resource reference, locale, created_at, read_at; durable inbox independent of external delivery. |
| NotificationDelivery | notification_id, channel, provider, attempt, state, provider_message_id, last_error_code, next_attempt_at; unique logical delivery key. |
| NotificationPreference / PushEndpoint | Per category/channel consent plus endpoint ownership/device/locale; invalidate token on logout, reassignment or provider rejection. |
| OutboxEvent | id, aggregate_type/id, aggregate_version, event_type, schema_version, safe payload, occurred_at, published_at, attempt_count; committed with domain transaction. |
| JobReceipt | consumer_name, event_id, completed_at, result_reference; unique consumer/event idempotency key. |
| ScheduledAction | type, aggregate_id, due_at, policy_version, state; durable claim/lease and cancellation, not an in-process timer. |
| AuditEvent | actor, acting principal, permission, target, request_id, timestamp, reason, policy_version and safe before/after; append-only with controlled retention. |
| AnalyticsEvent | unique event_id, schema_version, occurred_at, received_at, environment, pseudonymous actor/session, region, purpose, resource IDs; excludes evidence, exact location, message text and free-form case notes. |

## Database and transaction requirements

Foreign keys, check constraints and partial unique indexes must enforce invariants that can be enforced relationally. Subject-type references require validated ownership plus an enforceable subject reference strategy; do not rely on unchecked arbitrary IDs. Database implementation may merge supporting tables only when constraints, history and access boundaries remain intact.

Atomic operations include submission/publication, final-owner change, review eligibility creation/consumption, material offering revision, moderation action plus state change, and domain change plus outbox insertion. Optimistic version checks reject stale writes with a stable conflict response. Repeated idempotency keys with a different payload are rejected.

Before implementing each aggregate, derive migration constraints, server permissions and meaningful negative tests from this document. Existing generated SQL in historical artifacts is a design reference only; it has not been executed and must not be copied into production without reconciliation.
