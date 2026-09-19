Cameroon Housing Marketplace Data Model and Database Specification
PostgreSQL and PostGIS model for the approved Product Specification V2
Version 1.0
18 September 2026
Status  Ready for schema implementation
Execution model
One human product owner and operator supported by AI. Product scope remains unchanged.
Companion migration
001_initial_schema.sql
 
Document control
Item	Definition
Purpose	Define the implementation-ready relational model, database invariants, data boundaries and migration baseline for the approved marketplace product.
Source baseline	Cameroon Housing Marketplace Product Specification V2, approved by the product owner on 18 September 2026.
Database target	PostgreSQL 16 or later with PostGIS 3 or later, pgcrypto and citext.
Architecture	NestJS modular monolith using one primary relational database, Redis and BullMQ for cache and background work, and S3-compatible object storage for media.
Deliverables	This specification and the companion 001_initial_schema.sql migration.
Decision state	The domain model is approved. Configurable operational values, including freshness and review-window durations, remain environment or policy configuration rather than hard-coded database values.
Scope	Full approved product scope. The one-human-plus-AI execution model changes sequencing and controls, not features or domain coverage.
Implementation conclusion
The database is organized around distinct security principals, physical assets, advertisements, commercial terms and marketplace interactions. A user is not a provider account, a property is not a listing, and a listing is not an offering. These separations preserve history, support organizations, prevent trust badges from overstating what was checked and allow moderation to act on the correct resource.
The initial migration defines 92 tables across three schemas, 44 controlled types, 3 read views, 58 explicit indexes and 21 database triggers. The DDL is the field-level authority; this document explains why the objects exist and how the services must use them.
How approval affects implementation
Approval converts the proposed defaults in Product Specification V2 into the current build baseline. Provider identity is reviewed manually, seeker identity remains optional for normal contact and viewing requests, and a current declared property relationship is sufficient for MVP publication. Verified property authority receives a separate claim and public badge. Exact durations and pilot thresholds remain configurable until alpha and pilot evidence supports fixed values.
Contents
1 Architecture and execution model
2 Core relationship model
3 Database conventions
4 Geography and regional rollout
5 Users identity permissions and organizations
6 Verification and provider authority
7 Properties listings and offerings
8 Discovery conversations and viewing
9 Reviews and reputation
10 Trust safety audit and appeals
11 Notifications analytics and event delivery
12 Cross domain invariants and transaction boundaries
13 Search indexes and performance
14 Privacy retention and security
15 Migration validation and deployment
16 Implementation sequence and completion criteria
Appendix A Lifecycle persistence
Appendix B Complete table catalog
Appendix C Change record
1 Architecture and execution model
1.1 Database boundaries
The modular monolith owns one transactional database. Modules may share identifiers and transactions, but each module owns its tables and service methods. Direct cross-module writes are prohibited in application code. Cross-module changes run through domain services or explicit database transactions so authorization, audit and outbox events stay consistent.
Schema	Contents	Access rule
marketplace	Operational account, supply, interaction, review, notification and moderation records.	Application services receive only the permissions required by their module.
marketplace_private	Legal identity, exact property address, private viewing instructions and verification evidence links.	Purpose-limited service access; never returned through ordinary public endpoints.
marketplace_audit	Append-only audit records and transactional event outboxes.	Application roles append; protected investigator or worker roles read. Audit rows are not updated or deleted.
1.2 One human supported by AI
A single human can own product, engineering and operations work, but the database must not collapse those responsibilities into an unrestricted application role. Separate grants, step-up authentication and immutable audit records remain in place. The same person may hold several grants during development or early operations; each privileged action still records the permission used and the reason.
Activity	AI contribution	Human responsibility	Control
Schema and code	Draft migrations, tests, documentation and review suggestions.	Approve changes, merge and deploy.	Version control, CI and migration checks.
Product configuration	Recommend thresholds from measured behavior.	Approve freshness, review, service-time and pilot values.	Versioned policy or configuration records.
Verification and moderation	Summarize evidence and surface inconsistencies.	Make accountable decisions until an explicit automation policy is approved.	Scoped role, reason code, policy version and audit entry.
Production access	Prepare commands and diagnostic analysis without holding credentials.	Authenticate, authorize and execute protected operations.	Step-up authentication, expiring grants and correlation identifiers.
Release decision	Generate evidence and identify failed checks.	Make the go or no-go decision.	Release-gate record linked to test and pilot evidence.
AI is a development and operations assistant, not a second legal approver or credential holder. Where policy eventually requires two independent humans, release or production use must wait for that operational capacity; the product feature remains in scope.
1.3 Domain modules
Module	Owns	Does not own
Identity and access	Users, phones, sessions, grants and blocks.	Provider authority or listing publication.
Provider and organization	Provider profiles, provider accounts, organizations and memberships.	Physical property facts.
Verification	Claim submissions, evidence metadata, decisions and validity.	Account status or property ownership records.
Supply	Properties, authority relationships, listings, media selection and offerings.	Conversation or review content.
Marketplace interaction	Interactions, conversations, messages and viewings.	Moderation decisions.
Reputation	Eligibility, blind windows, review content and derived summaries.	No-show enforcement or risk scores.
Trust and safety	Reports, cases, assignments, actions, appeals and audit linkage.	Ordinary product analytics.
Platform services	Notifications, outboxes, regional controls and retention policies.	Domain decisions owned by other modules.
2 Core relationship model
The core relationship model prevents role, asset and transaction history from being overwritten as users change capabilities or providers change inventory. The provider account remains the accountable public principal for a listing, while the user record identifies the person taking each action.
 
Figure 1  Core marketplace relationship model
2.1 Principal and resource distinctions
Object	Authoritative meaning	Why it remains separate
User	A real account holder and security principal.	One person can seek housing, provide property and act for an organization without duplicate accounts.
Provider profile	A person's provider capability and type.	Provider lifecycle and identity verification must not change the user's base account state.
Provider account	The public individual or organization responsible for a listing.	An organization owns responsibility while a member remains the action actor.
Property	The persistent physical asset.	Price, availability and marketing can change without replacing the asset record.
Listing	One marketplace advertisement.	Publication, market and moderation lifecycles differ from property state.
Offering	Versioned commercial terms.	Price history and purpose-specific terms stay out of the property record.
Interaction	Business relationship among seeker, provider account and listing.	Messaging, calls and viewings share one marketplace context.
Review eligibility	Single-use right created by an eligible event.	Prevents open anonymous review creation and supports double-blind release.
3 Database conventions
3.1 Keys time and concurrency
•	Every domain record uses an immutable UUID primary key. High-volume history and audit tables may use identity-backed bigint keys where ordering and storage efficiency matter.
•	All instants use timestamptz and are stored in UTC. A viewing also stores its IANA timezone, with Africa/Douala as the launch default.
•	Mutable aggregate roots carry row_version and updated_at. APIs use the version for optimistic concurrency and return a conflict when a stale client attempts an update.
•	Application deletes are exceptional. Lifecycle states, archived timestamps and retention jobs preserve history until an approved deletion rule applies.
3.2 Money localization and controlled values
•	Money is stored as an integer minor-unit amount plus an ISO 4217 currency code. XAF is the default, but currency remains explicit on every offering.
•	English and French labels live in reference tables or application localization files. User-generated text remains unchanged in MVP.
•	Stable lifecycle values use PostgreSQL enums. Product-managed catalogs such as property types, amenities and review criteria use reference tables so labels and availability can change without rewriting history.
•	Free-form policy reasons are not status values. Services write controlled reason codes and may add protected internal notes only where the schema permits them.
3.3 State and history
Current state remains on the aggregate root for efficient authorization and queues. Material transitions also write a dedicated history row or append-only audit entry in the same transaction. A state change without its required history and event records is treated as an incomplete transaction.
Pattern	Use
Current state column	Fast policy checks, queues, discovery and API responses.
Dedicated state history	Frequent operational lifecycles such as listing, viewing, verification and review.
Audit log	Security-sensitive action, grant, decision or correction with actor and request context.
Domain outbox	Reliable asynchronous notification, indexing, analytics and background processing after commit.
4 Geography and regional rollout
Location is structured for search and privacy. Region, locality, neighborhood and landmark records support English and French names. Exact addresses live in the private schema, while the property and listing expose only the approved public precision and optional public point.
4.1 Tables
Table	Primary responsibility	Key relationships	Data class
regions	Controlled Cameroon region reference data.	Parent of localities and rollout settings.	Public
localities	Cities, municipalities and towns used by structured search.	Belongs to a region; parent of neighborhoods.	Public
neighborhoods	Neighborhood and area reference records.	Belongs to a locality; referenced by properties.	Public
landmarks	Searchable landmark names, aliases and optional coordinates.	Belongs to a locality and optionally a neighborhood.	Public
regional_rollouts	Controls preregistration, publishing and discovery by region.	One row per region.	Internal
region_preregistrations	Captures demand before a region opens.	Links a user or phone to a requested region.	Confidential
4.2 Rollout policy
•	Southwest and Littoral are seeded as active publishing and discovery regions.
•	Other regions can exist in the reference model with preregistration enabled while publishing and discovery remain disabled.
•	A listing publication check reads regional_rollouts; a client flag cannot bypass it.
•	Location aliases belong to landmark data or the search index, not free-form provider fields.
5 Users identity permissions and organizations
 
Figure 2  Identity organization and verification model
5.1 Account and identity rules
•	One canonical E.164 phone may identify only one account. Changing the primary phone creates new verification history instead of editing the old number in place.
•	Public profile data and legal identity data use separate tables and schemas.
•	OTP values and refresh tokens are stored only as digests. Rate limits and attempt limits are enforced by the service and cache layers as well as persisted challenge limits.
•	Account status is independent of provider, organization and verification status.
5.2 User authentication privacy and media tables
Table	Primary responsibility	Key relationships	Data class
users	Canonical account and security principal.	Referenced by all actor and ownership records.	Confidential
user_phones	Canonical E.164 phone ownership and verification state.	Many historical phones per user; one active primary.	Restricted
otp_challenges	Hashed one-time-code challenges with expiry and attempt limits.	May precede user creation.	Restricted
user_sessions	Refresh-session digests, device context and revocation.	Belongs to one user.	Restricted
account_status_history	Immutable account lifecycle changes.	Links target user, actor and correlation identifier.	Restricted
marketplace_private.user_identities	Encrypted legal identity attributes kept outside public profiles.	One-to-one with users.	Restricted
data_deletion_requests	Waiting period and processing state for account erasure requests.	Belongs to one user.	Restricted
user_public_profiles	Public display name, biography and avatar.	One-to-one with users; avatar uses media assets.	Public
media_assets	Stored-object metadata, hashes and processing state.	Uploaded by a user; reused through link tables.	Mixed
media_variants	Optimized image or media derivatives.	Belongs to one media asset.	Mixed
device_tokens	Push-delivery token digests and revocation state.	Belongs to one user.	Restricted
idempotency_keys	Safe replay record for mobile and network retries.	Scoped to a user, route and client key.	Internal
retention_policies	Versioned retention rules by data class and trigger event.	Optionally linked to a policy version.	Internal
5.3 Provider and organization rules
•	A provider account references exactly one individual provider profile or one organization. A database check rejects a record containing both or neither.
•	Organization access combines membership role, active state and listing assignment or organization-wide permission.
•	The application must prevent removal of the final active organization owner unless an approved recovery or ownership-transfer transaction succeeds.
•	One person may hold multiple administrative grants. The request must still declare and pass the permission used for each privileged action.
5.4 Provider organization and permission tables
Table	Primary responsibility	Key relationships	Data class
provider_profiles	A person's owner, agent or property-manager capability.	One-to-one with a user.	Public and internal
organizations	Agency, management company or corporate-owner principal.	Referenced by provider accounts and memberships.	Public and confidential
provider_accounts	The individual or organization publicly responsible for listings.	Exactly one provider profile or organization.	Public and internal
organization_memberships	Invitation, role and access lifecycle for organization members.	Links users and organizations.	Confidential
organization_membership_history	Role and state change history for memberships.	Belongs to one membership and actor.	Restricted
permissions	Stable permission-code catalog.	Referenced by organization and admin mappings.	Internal
admin_roles	Named administrative role definitions and step-up requirement.	Parent of admin-role permission mappings.	Restricted
admin_role_permissions	Permissions granted to each administrative role.	Many-to-many role and permission mapping.	Restricted
organization_role_permissions	Default capabilities for organization roles.	Many-to-many role and permission mapping.	Internal
user_admin_role_assignments	Scoped and expiring administrative grants.	Links user, admin role, grantor and optional region.	Restricted
organization_listing_assignments	Resource assignment for members without organization-wide access.	Links a listing and membership.	Confidential
6 Verification and provider authority
Verification represents one claim about one subject. The claim type determines the allowed subject: phone or identity claims target a user, provider identity targets a provider profile, business verification targets an organization and property authority targets a provider-property relationship.
6.1 Approved MVP policy
Decision	Approved baseline	Database treatment
Provider evidence	Government ID plus selfie or approved equivalent, reviewed manually.	Private evidence links, numbered submissions, reviewer decision and policy version.
Seeker identity	Optional for normal contact and viewing; phone verification is the default threshold.	Identity claim supported without becoming a universal interaction foreign key.
Property authority	Current declared relationship is sufficient for MVP publication; verified authority earns a separate badge.	Publication allows DECLARED, PENDING or VERIFIED current relationships. Only VERIFIED claim appears as authority verification.
Evidence retention	Configured by evidence type after privacy and legal review.	retention_until on evidence plus versioned retention_policies.
6.2 Decision integrity
•	Each decision stores the reviewer, reason code, policy version and time. A reviewer cannot approve their own submission through the service policy.
•	Public badges query current VERIFIED claims and disappear automatically when their validity ends or status changes.
•	Evidence uses private media assets and short-lived service-mediated access. Storage object keys never enter ordinary API responses.
•	Revoking property authority triggers reevaluation of dependent listings in the same domain workflow.
6.3 Property authority and verification tables
Table	Primary responsibility	Key relationships	Data class
property_types	Localized property-type reference data.	Referenced by properties.	Public
furnishing_types	Localized furnishing reference data.	Referenced by properties.	Public
property_conditions	Localized property-condition reference data.	Referenced by properties.	Public
properties	Canonical physical asset with structured public attributes.	Parent of addresses, amenities, media and listings.	Public and confidential
marketplace_private.property_addresses	Encrypted exact address and exact coordinate.	One-to-one with properties.	Restricted
amenities	Localized amenity catalog.	Referenced by property-amenity links.	Public
property_amenities	Amenities attached to a property.	Many-to-many property and amenity mapping.	Public
property_media	Approved media order and primary image for a property.	Links properties and media assets.	Public and internal
property_duplicate_candidates	Potential duplicate pair with detection and review result.	References two properties and an optional reviewer.	Internal
property_merge_history	Immutable source-to-canonical merge record.	References two properties and the moderator.	Restricted
provider_property_relationships	Owner, agent or manager authority over one property.	Links property and provider account.	Public and confidential
policy_versions	Hash and effective dates for verification and enforcement policy.	Referenced by decisions and actions.	Internal
verification_claims	Current state of one claim about one supported subject.	Targets a user, provider, organization or authority relationship.	Confidential
verification_submissions	Numbered evidence submission attempts for a claim.	Belongs to a verification claim and submitting user.	Restricted
marketplace_private.verification_evidence	Private evidence-object links and retention dates.	Belongs to a submission and media asset.	Restricted
verification_decisions	Reviewer decision, reason and policy version.	Belongs to a claim and optional submission.	Restricted
verification_state_history	Claim-state transition history.	Links a claim, decision and actor.	Restricted
7 Properties listings and offerings
 
Figure 3  Property listing and offering model
7.1 Publication invariant
A listing can enter PUBLISHED only when its property is active, its provider and underlying individual or organization are active, the provider has the required current verification, the provider-property relationship is current, the region allows publishing, moderation is approved, a ready public image exists, freshness dates are current and one compatible active offering with the correct subtype exists. The migration implements this as a database trigger in addition to service-level authorization.
7.2 Independent state dimensions
Dimension	Examples	Why separate
Publication	DRAFT, PENDING_REVIEW, PUBLISHED, PAUSED, EXPIRED, HIDDEN, REMOVED	Controls advertisement lifecycle and provider intent.
Market	AVAILABLE, UNDER_OFFER, RENTED, SOLD, UNAVAILABLE	Describes commercial availability and differs by purpose.
Moderation	NOT_REVIEWED, IN_REVIEW, APPROVED, CHANGES_REQUIRED, ESCALATED	Records platform review independently of provider publication state.
7.3 Commercial versioning
•	A listing can have many historical offerings but only one active offering.
•	The listing purpose and offering purpose are linked by a composite foreign key.
•	Subtype triggers prevent rent, sale or short-let terms from attaching to the wrong offering.
•	Payments, escrow, booking inventory and booking confirmation are intentionally absent from the MVP schema. Their later modules can reference listings and offerings without rewriting them.
7.4 Listing offering and discovery tables
Table	Primary responsibility	Key relationships	Data class
listing_market_status_rules	Purpose-compatible market states and discoverability.	Composite reference for listings.	Internal
listings	Marketplace advertisement with independent publication, market and moderation states.	Links property, provider account and authority relationship.	Public and internal
listing_media	Property media selected and ordered for one listing.	Composite link to listing and property media.	Public
listing_revisions	Immutable snapshot of material listing versions.	Belongs to a listing and author.	Confidential
listing_state_history	Publication, market and moderation transition history.	Belongs to a listing and actor.	Restricted
listing_freshness_confirmations	Provider confirmation and next expiry date.	Belongs to a listing and confirming user.	Internal
listing_moderation_reviews	Listing review decision and policy basis.	Links listing, revision and reviewer.	Restricted
offerings	Versioned currency, price, period and negotiation terms.	Belongs to one listing and purpose.	Public and internal
rental_offering_terms	Rent-specific deposit, advance, lease and charge fields.	One-to-one with a rent offering.	Public
sale_offering_terms	Sale-specific availability fields.	One-to-one with a sale offering.	Public
short_let_offering_terms	Nightly-stay, guest and fee fields without booking state.	One-to-one with a short-let offering.	Public
saved_listings	Idempotent user-to-listing save relationship.	Links users and listings.	Confidential
saved_searches	Structured saved filters and early-release alert settings.	Belongs to one user.	Confidential
8 Discovery conversations and viewing
 
Figure 4  Interaction viewing and review model
8.1 Interaction identity
The partial unique index on seeker, provider account and listing permits only one open interaction for that combination. Closing the interaction preserves history and allows a later interaction when policy permits. The listing-provider composite foreign key prevents a client from substituting an unrelated provider account.
8.2 Messaging
•	Each conversation belongs to exactly one interaction. Conversation authorization is derived from the interaction, current account state, organization membership and blocks.
•	Messages store the actual sender user and an optional acting provider account. This preserves personal accountability when an organization member speaks for the provider account.
•	Client message identifiers make retry safe. Message text is excluded from application logs and product analytics.
•	Voice and general attachments use the same media path but remain gated until processing, reporting and retention controls are released.
8.3 Viewing completion
•	A viewing inherits listing, seeker and provider context from its interaction; callers cannot replace those identifiers.
•	Schedule changes create history rather than overwriting the prior appointment.
•	Private instructions remain encrypted and are revealed only after the configured scheduling condition.
•	Completion normally needs both party confirmations or one confirmation followed by an uncontested deadline. A dispute holds review eligibility.
8.4 Interaction conversation and viewing tables
Table	Primary responsibility	Key relationships	Data class
interactions	Business context connecting seeker, provider account and listing.	Parent of one conversation and many viewings.	Confidential
interaction_state_history	Interaction-state change history.	Belongs to one interaction and actor.	Restricted
conversations	One-to-one message container for an interaction.	Belongs to one interaction.	Confidential
messages	Text or system message with actual sender and optional provider context.	Belongs to a conversation.	Restricted
message_attachments	Early-release image, document or voice links.	Links messages and media assets.	Restricted
message_receipts	Per-user delivery and read timestamps.	Links messages and users.	Confidential
user_blocks	Directional user block with optional reason.	Links blocker and blocked user.	Restricted
viewings	Viewing request through completion, cancellation, no-show or dispute.	Belongs to one interaction.	Confidential
viewing_schedule_history	Every proposed and accepted schedule version.	Belongs to a viewing and actor.	Confidential
marketplace_private.viewing_instructions	Encrypted private location and access instructions.	One-to-one with a viewing.	Restricted
viewing_confirmations	Seeker and provider completion, no-show or dispute claims.	One record per viewing party.	Restricted
viewing_state_history	Viewing-state transition history.	Belongs to a viewing and actor.	Restricted
9 Reviews and reputation
A completed or otherwise eligible marketplace event creates a review round. Each eligibility defines one author principal, one subject and one reason. The unique eligibility index prevents duplicate rights for the same event, author and subject.
9.1 Double blind release
1. The review round opens after the eligible event is accepted.
2. A submitted review enters SUBMITTED_HELD and remains hidden from the counterparty.
3. The release worker publishes when both counterparties submit or the configured blind window closes.
4. A report or moderator may move the review through REPORTED, UNDER_REVIEW, HIDDEN or REMOVED without deleting history.
9.2 Reputation rules
•	Published eligible reviews contribute to derived reputation summaries. Hidden or removed reviews stop contributing.
•	Criterion scores use a controlled catalog by subject type. Provider, seeker and property criteria are not mixed.
•	No-show counts and completed interactions remain separate operational measures rather than components hidden inside a star rating.
•	Edit history preserves the rating, text and criterion snapshot used at each version.
9.3 Review tables
Table	Primary responsibility	Key relationships	Data class
review_rounds	Double-blind publication window for one eligible event.	One-to-one with the source viewing.	Internal
review_eligibilities	Single-use author and subject entitlement.	Belongs to a review round; targets user, provider or property.	Confidential
reviews	Rating, text and blind-publication state.	Consumes one eligibility.	Public and confidential
review_criteria	Localized structured-rating criteria by subject type.	Referenced by review scores.	Public
review_scores	Criterion-level scores for a review.	Links reviews and criteria.	Public
review_versions	Edit history and score snapshots.	Belongs to one review and editor.	Restricted
review_state_history	Review moderation and publication transitions.	Belongs to a review and actor.	Restricted
10 Trust safety audit and appeals
 
Figure 5  Moderation audit and event delivery model
10.1 Report and case separation
A report is an allegation made by a user. A moderation case is the platform investigation. Several related reports can join one case, and one report can be reattached if an investigation is consolidated. This prevents report status from being mistaken for an enforcement decision.
10.2 Material action requirements
•	Every action names its case, actor, action type, typed target, reason code, request correlation identifier and policy version when applicable.
•	before_state and after_state support investigation and reversal without mutating the original action.
•	moderation_actions and audit_log are append-only. A correction is a new action linked to the same case.
•	An appeal links to the original action and records the resolver separately from the original actor.
10.3 Trust and safety tables
Table	Primary responsibility	Key relationships	Data class
reports	A user allegation against one supported target.	Links reporter and exactly one target.	Restricted
report_attachments	Evidence attached to a report.	Links reports and private media.	Restricted
moderation_cases	Platform investigation that can group several reports.	Parent of reports, assignments, actions and appeals.	Restricted
moderation_case_reports	Many-to-many report-to-case association.	Links moderation cases and reports.	Restricted
moderation_case_assignments	Moderator ownership periods for a case.	Links case, assignee and assigning user.	Restricted
moderation_actions	Immutable enforcement action with before and after state.	Links case, actor, policy and exactly one target.	Restricted
appeals	Appeal and resolution tied to the original action.	Links action, appellant and resolver.	Restricted
11 Notifications analytics and event delivery
11.1 Transactional outbox pattern
The domain transaction writes business state, history, audit and an outbox event before commit. BullMQ workers may then deliver notifications, update external search indexes or forward approved analytics. This prevents a successful user action from losing its asynchronous work and prevents a failed transaction from emitting a false event.
Record	Reliability key	Sensitive-data rule
Notification	Unique idempotency key and one delivery row per channel.	Localization keys and safe resource identifiers only.
Domain event	Unique idempotency key, aggregate identifier, retry status and attempt count.	Payload contains the minimum required by the worker.
Analytics event	Unique idempotency key, source version, environment and event time.	No identity evidence, exact address, message text or free-form moderation notes.
Audit record	Request correlation identifier and append-only trigger.	Hashes replace raw network identifiers; protected access only.
11.2 Notification preferences
•	Security notices cannot be disabled through the preference table.
•	Marketing uses a separate category and explicit consent.
•	A deep link never grants access; the destination API rechecks authorization.
•	Generated, sent, delivered, opened and acted states remain distinct for analytics.
11.3 Notification audit and event tables
Table	Primary responsibility	Key relationships	Data class
notification_preferences	Channel and category consent, with security notices protected.	Belongs to a user.	Confidential
notifications	Localized notification intent and authorized deep-link target.	Belongs to a recipient user.	Confidential
notification_deliveries	Per-channel queue, retry and engagement state.	Belongs to one notification.	Internal
marketplace_audit.audit_log	Append-only security and material change record.	Links actor, session, target and request correlation.	Restricted
marketplace_audit.domain_event_outbox	Transactional events for jobs and integrations.	References an aggregate by stable identifier.	Internal
marketplace_audit.analytics_event_outbox	Validated product-event envelope without sensitive content.	Carries approved resource and segmentation identifiers.	Internal
12 Cross domain invariants and transaction boundaries
12.1 Database enforced invariants
Invariant	Database mechanism
A provider account is individual or organization, never both.	XOR check constraint.
A verification claim has exactly one valid subject for its type.	num_nonnulls and type-to-subject check constraints.
A listing relationship matches both its property and provider account.	Composite foreign key.
A market state is compatible with the listing purpose.	Composite foreign key to listing_market_status_rules.
A listing has at most one active offering.	Partial unique index.
Purpose-specific terms match the offering purpose.	Subtype validation triggers.
One open interaction exists per seeker, provider and listing.	Partial unique index.
Review eligibility is unique per event, author and subject.	Expression-based unique index.
Reports and moderation actions target exactly one typed resource.	Typed nullable foreign keys plus count and mapping checks.
Material moderation and audit records cannot be rewritten.	Append-only update and delete prevention triggers.
Published listings satisfy trust, moderation, media, region, freshness and offering requirements.	Publication guard trigger and discoverable-listings view.
12.2 Service enforced policies
Policy	Why the service owns it	Required evidence
Actor authorization and organization assignment	Depends on session, role, resource and policy context.	Permission decision and audit entry for privileged actions.
Allowed lifecycle transition	Some transitions depend on remediation, appeal or timing.	Domain test and state-history row.
Final organization owner protection	May require transfer or recovery flow across several records.	Serializable transaction and membership history.
Message participant authorization	Organization actors change over time.	Current membership or seeker identity plus block check.
Double-blind review release	Depends on both submissions and a configurable deadline.	Idempotent worker and release timestamp.
Retention and legal hold	Depends on approved policy, case status and evidence type.	Retention policy version and deletion job result.
12.3 Required transaction groups
Operation	Records committed together
Account state change	users, account_status_history, audit_log and domain_event_outbox.
Verification decision	verification_decisions, verification_claims, verification_state_history, audit_log and domain event.
Listing submission or publication	listing revision, listings state, listing_state_history, audit entry when privileged and domain event.
Viewing confirmation	viewing_confirmations, viewings state, history and review-round creation when eligible.
Review release	review statuses, review round release time, reputation invalidation event and notification intents.
Moderation action	moderation_actions, target state, audit_log, case state when required and domain event.
13 Search indexes and performance
13.1 Primary access paths
Use case	Index or view	Notes
Public discovery	discoverable_listings plus composite listing-state index	Excludes expired, unavailable, unverified or region-disabled supply.
Keyword search	GIN index on listing search_vector	Uses title and description; structured location remains separate.
Geographic search	GiST indexes on public_point and landmark location	Exact property points remain in the private schema.
Moderation queues	Partial indexes on listing, verification, report, case and appeal states	Queue indexes exclude completed work.
Messaging	conversation and sent_at descending index	Supports cursor pagination without scanning message bodies.
Viewing reminders	Partial index on scheduled times for scheduled and rescheduled viewings	Worker queries a bounded time window.
Audit investigation	Target composite index and BRIN time index	Supports resource history and time-range scans.
Outbox workers	Partial status and available-time indexes	Retries do not scan processed events.
13.2 Query rules
•	Public clients query an API read model, never base private tables.
•	List endpoints use keyset pagination on stable indexed columns rather than offset pagination at scale.
•	Analytics aggregation runs from approved event streams or replicas and does not add ad hoc joins to latency-sensitive marketplace paths.
•	The private pilot establishes real query plans and cardinalities before partitioning or denormalizing.
14 Privacy retention and security
14.1 Data classification
Class	Examples	Handling
Public	Published listing fields, approved media, provider public name and current public badges.	Returned only through eligibility-filtered read models.
Internal	Queue state, configurations, derived metrics and outbox status.	Authenticated service and authorized admin access.
Confidential	Phone number, messages, saves, interactions, private notes and notification history.	Purpose-limited APIs, encryption at rest and no analytics copying.
Restricted	Legal identity, verification evidence, exact address, viewing instructions, audit and moderation evidence.	Private schema, least privilege, short-lived object access, access logging and retention control.
14.2 Retention and erasure
•	Retention starts from a defined trigger such as submission, decision, case closure or account deletion, not from an ambiguous last-updated time.
•	Legal or safety holds pause destructive deletion while preserving the approved decision record.
•	Deleting an evidence object does not delete the verification decision, policy version, reason code or audit history.
•	Account deletion removes or anonymizes user-facing data according to policy while preserving records required for fraud prevention, disputes and legal obligations.
14.3 Database access
•	Production uses separate migration, application, worker, analytics and investigator roles. The initial migration intentionally does not create environment-specific database users.
•	The migration revokes public access to the private and audit schemas. Deployment grants must be explicit and environment-specific.
•	Administrative actions require short-lived sessions and step-up authentication where the role or action requires it.
•	Raw credentials, OTP values, tokens, identity documents, message bodies and exact addresses must not enter application logs.
15 Migration validation and deployment
15.1 Migration order
1. Enable pgcrypto, citext and PostGIS in the target environment.
2. Create marketplace, marketplace_private and marketplace_audit schemas and controlled types.
3. Create reference, account, provider, property and verification tables.
4. Create listing, interaction, reputation, moderation and notification tables.
5. Create constraints, partial indexes, triggers, read views and seed reference values.
6. Apply environment-specific roles and grants outside the product migration.
7. Run migration, constraint, authorization, publication and rollback or forward-repair tests in CI.
15.2 Required automated tests
Test family	Minimum proof
Migration	Fresh database applies cleanly; an approved previous version upgrades without data loss; repeat execution is controlled by the migration framework.
Foreign keys	Unrelated provider, property, listing and interaction identifiers cannot be substituted.
Publication	Every missing prerequisite blocks PUBLISHED and every valid combination succeeds.
Privacy	Public database role cannot select restricted tables; public API serialization excludes private fields.
Authorization	Direct API calls cannot bypass organization assignment, verification, suspension, blocks or moderation holds.
Idempotency	Repeated message, viewing, notification and review requests produce one logical result.
Concurrency	Two stale listing or moderation updates cannot silently overwrite each other.
Audit	Privileged state changes create an immutable action or audit row with correlation identifier.
Analytics	Retries deduplicate, required properties validate and prohibited content never reaches analytics outbox.
15.3 Seed data ownership
The migration seeds launch regions, basic property and furnishing references, review criteria, permission codes and role-permission defaults. Amenities, complete Cameroon locality data, reason codes and policy versions require version-controlled product data migrations before pilot inventory is loaded.
16 Implementation sequence and completion criteria
16.1 Recommended sequence
Step	Implementation output	Completion evidence
1	Create a NestJS migration project and run this DDL against PostgreSQL with PostGIS.	Clean apply in local and CI databases.
2	Generate ORM or query-layer types without allowing schema generation to replace the migration.	Type build and schema-drift check pass.
3	Implement identity, provider, organization, property and verification repositories.	Repository and authorization tests pass.
4	Implement the listing publication transaction and discoverable read model.	Vertical-slice publish tests pass.
5	Add interaction, message, viewing and review transactions.	End-to-end seeker and provider flow passes.
6	Add moderation, audit, notification and event workers.	Case-to-action rehearsal and retry tests pass.
7	Load controlled location and policy data for Southwest and Littoral.	Pilot seed-data validation passes.
16.2 Data model gate
•	The migration applies to an empty PostgreSQL 16 and PostGIS database.
•	Every approved aggregate and lifecycle in Product Specification V2 has an authoritative table and status representation.
•	All sensitive data has a classification, access boundary and retention path.
•	Critical cross-resource relationships use foreign keys or explicit transaction tests.
•	Publication, review eligibility, moderation action and analytics paths have automated invariant tests.
•	Schema changes run only through versioned migrations; no normal release requires manual production editing.
After this gate passes, the next product stage is complete user journeys and the design system for seeker, provider, agency member and moderator flows. API contracts can then be written against the approved journeys and this schema.
Appendix A Lifecycle persistence
Object	Current state	History or audit source
User	users.account_status	account_status_history plus audit_log
Provider profile	provider_profiles.status	audit_log and provider domain events
Provider account	provider_accounts.status	audit_log and provider domain events
Organization	organizations.status	audit_log and organization domain events
Membership	organization_memberships.status and role	organization_membership_history
Verification	verification_claims.status	verification_state_history and verification_decisions
Property	properties.record_status	property_merge_history and audit_log
Authority	provider_property_relationships.authorization_status	verification decisions and audit_log
Listing publication	listings.publication_status	listing_state_history and listing_revisions
Listing market	listings.market_status	listing_state_history
Listing moderation	listings.moderation_status	listing_state_history and listing_moderation_reviews
Interaction	interactions.status	interaction_state_history
Viewing	viewings.status	viewing_state_history, schedule history and confirmations
Review	reviews.status	review_state_history and review_versions
Report	reports.status	audit_log and case links
Moderation case	moderation_cases.status	moderation_actions, assignments and audit_log
Appeal	appeals.status	original action, resolution fields and audit_log
Notification delivery	notification_deliveries.status	channel timestamps and worker event history
Appendix B Complete table catalog
The tables below are the complete initial migration inventory. Field types, nullability, constraints, indexes and seed values remain authoritative in 001_initial_schema.sql.
Geography and regional rollout
Table	Primary responsibility	Key relationships	Data class
regions	Controlled Cameroon region reference data.	Parent of localities and rollout settings.	Public
localities	Cities, municipalities and towns used by structured search.	Belongs to a region; parent of neighborhoods.	Public
neighborhoods	Neighborhood and area reference records.	Belongs to a locality; referenced by properties.	Public
landmarks	Searchable landmark names, aliases and optional coordinates.	Belongs to a locality and optionally a neighborhood.	Public
regional_rollouts	Controls preregistration, publishing and discovery by region.	One row per region.	Internal
region_preregistrations	Captures demand before a region opens.	Links a user or phone to a requested region.	Confidential
Users authentication privacy and media
Table	Primary responsibility	Key relationships	Data class
users	Canonical account and security principal.	Referenced by all actor and ownership records.	Confidential
user_phones	Canonical E.164 phone ownership and verification state.	Many historical phones per user; one active primary.	Restricted
otp_challenges	Hashed one-time-code challenges with expiry and attempt limits.	May precede user creation.	Restricted
user_sessions	Refresh-session digests, device context and revocation.	Belongs to one user.	Restricted
account_status_history	Immutable account lifecycle changes.	Links target user, actor and correlation identifier.	Restricted
marketplace_private.user_identities	Encrypted legal identity attributes kept outside public profiles.	One-to-one with users.	Restricted
data_deletion_requests	Waiting period and processing state for account erasure requests.	Belongs to one user.	Restricted
user_public_profiles	Public display name, biography and avatar.	One-to-one with users; avatar uses media assets.	Public
media_assets	Stored-object metadata, hashes and processing state.	Uploaded by a user; reused through link tables.	Mixed
media_variants	Optimized image or media derivatives.	Belongs to one media asset.	Mixed
device_tokens	Push-delivery token digests and revocation state.	Belongs to one user.	Restricted
idempotency_keys	Safe replay record for mobile and network retries.	Scoped to a user, route and client key.	Internal
retention_policies	Versioned retention rules by data class and trigger event.	Optionally linked to a policy version.	Internal
Providers organizations and permissions
Table	Primary responsibility	Key relationships	Data class
provider_profiles	A person's owner, agent or property-manager capability.	One-to-one with a user.	Public and internal
organizations	Agency, management company or corporate-owner principal.	Referenced by provider accounts and memberships.	Public and confidential
provider_accounts	The individual or organization publicly responsible for listings.	Exactly one provider profile or organization.	Public and internal
organization_memberships	Invitation, role and access lifecycle for organization members.	Links users and organizations.	Confidential
organization_membership_history	Role and state change history for memberships.	Belongs to one membership and actor.	Restricted
permissions	Stable permission-code catalog.	Referenced by organization and admin mappings.	Internal
admin_roles	Named administrative role definitions and step-up requirement.	Parent of admin-role permission mappings.	Restricted
admin_role_permissions	Permissions granted to each administrative role.	Many-to-many role and permission mapping.	Restricted
organization_role_permissions	Default capabilities for organization roles.	Many-to-many role and permission mapping.	Internal
user_admin_role_assignments	Scoped and expiring administrative grants.	Links user, admin role, grantor and optional region.	Restricted
organization_listing_assignments	Resource assignment for members without organization-wide access.	Links a listing and membership.	Confidential
Properties authority and verification
Table	Primary responsibility	Key relationships	Data class
property_types	Localized property-type reference data.	Referenced by properties.	Public
furnishing_types	Localized furnishing reference data.	Referenced by properties.	Public
property_conditions	Localized property-condition reference data.	Referenced by properties.	Public
properties	Canonical physical asset with structured public attributes.	Parent of addresses, amenities, media and listings.	Public and confidential
marketplace_private.property_addresses	Encrypted exact address and exact coordinate.	One-to-one with properties.	Restricted
amenities	Localized amenity catalog.	Referenced by property-amenity links.	Public
property_amenities	Amenities attached to a property.	Many-to-many property and amenity mapping.	Public
property_media	Approved media order and primary image for a property.	Links properties and media assets.	Public and internal
property_duplicate_candidates	Potential duplicate pair with detection and review result.	References two properties and an optional reviewer.	Internal
property_merge_history	Immutable source-to-canonical merge record.	References two properties and the moderator.	Restricted
provider_property_relationships	Owner, agent or manager authority over one property.	Links property and provider account.	Public and confidential
policy_versions	Hash and effective dates for verification and enforcement policy.	Referenced by decisions and actions.	Internal
verification_claims	Current state of one claim about one supported subject.	Targets a user, provider, organization or authority relationship.	Confidential
verification_submissions	Numbered evidence submission attempts for a claim.	Belongs to a verification claim and submitting user.	Restricted
marketplace_private.verification_evidence	Private evidence-object links and retention dates.	Belongs to a submission and media asset.	Restricted
verification_decisions	Reviewer decision, reason and policy version.	Belongs to a claim and optional submission.	Restricted
verification_state_history	Claim-state transition history.	Links a claim, decision and actor.	Restricted
Listings offerings and discovery
Table	Primary responsibility	Key relationships	Data class
listing_market_status_rules	Purpose-compatible market states and discoverability.	Composite reference for listings.	Internal
listings	Marketplace advertisement with independent publication, market and moderation states.	Links property, provider account and authority relationship.	Public and internal
listing_media	Property media selected and ordered for one listing.	Composite link to listing and property media.	Public
listing_revisions	Immutable snapshot of material listing versions.	Belongs to a listing and author.	Confidential
listing_state_history	Publication, market and moderation transition history.	Belongs to a listing and actor.	Restricted
listing_freshness_confirmations	Provider confirmation and next expiry date.	Belongs to a listing and confirming user.	Internal
listing_moderation_reviews	Listing review decision and policy basis.	Links listing, revision and reviewer.	Restricted
offerings	Versioned currency, price, period and negotiation terms.	Belongs to one listing and purpose.	Public and internal
rental_offering_terms	Rent-specific deposit, advance, lease and charge fields.	One-to-one with a rent offering.	Public
sale_offering_terms	Sale-specific availability fields.	One-to-one with a sale offering.	Public
short_let_offering_terms	Nightly-stay, guest and fee fields without booking state.	One-to-one with a short-let offering.	Public
saved_listings	Idempotent user-to-listing save relationship.	Links users and listings.	Confidential
saved_searches	Structured saved filters and early-release alert settings.	Belongs to one user.	Confidential
Interactions conversations and viewing
Table	Primary responsibility	Key relationships	Data class
interactions	Business context connecting seeker, provider account and listing.	Parent of one conversation and many viewings.	Confidential
interaction_state_history	Interaction-state change history.	Belongs to one interaction and actor.	Restricted
conversations	One-to-one message container for an interaction.	Belongs to one interaction.	Confidential
messages	Text or system message with actual sender and optional provider context.	Belongs to a conversation.	Restricted
message_attachments	Early-release image, document or voice links.	Links messages and media assets.	Restricted
message_receipts	Per-user delivery and read timestamps.	Links messages and users.	Confidential
user_blocks	Directional user block with optional reason.	Links blocker and blocked user.	Restricted
viewings	Viewing request through completion, cancellation, no-show or dispute.	Belongs to one interaction.	Confidential
viewing_schedule_history	Every proposed and accepted schedule version.	Belongs to a viewing and actor.	Confidential
marketplace_private.viewing_instructions	Encrypted private location and access instructions.	One-to-one with a viewing.	Restricted
viewing_confirmations	Seeker and provider completion, no-show or dispute claims.	One record per viewing party.	Restricted
viewing_state_history	Viewing-state transition history.	Belongs to a viewing and actor.	Restricted
Reviews and reputation
Table	Primary responsibility	Key relationships	Data class
review_rounds	Double-blind publication window for one eligible event.	One-to-one with the source viewing.	Internal
review_eligibilities	Single-use author and subject entitlement.	Belongs to a review round; targets user, provider or property.	Confidential
reviews	Rating, text and blind-publication state.	Consumes one eligibility.	Public and confidential
review_criteria	Localized structured-rating criteria by subject type.	Referenced by review scores.	Public
review_scores	Criterion-level scores for a review.	Links reviews and criteria.	Public
review_versions	Edit history and score snapshots.	Belongs to one review and editor.	Restricted
review_state_history	Review moderation and publication transitions.	Belongs to a review and actor.	Restricted
Trust safety and moderation
Table	Primary responsibility	Key relationships	Data class
reports	A user allegation against one supported target.	Links reporter and exactly one target.	Restricted
report_attachments	Evidence attached to a report.	Links reports and private media.	Restricted
moderation_cases	Platform investigation that can group several reports.	Parent of reports, assignments, actions and appeals.	Restricted
moderation_case_reports	Many-to-many report-to-case association.	Links moderation cases and reports.	Restricted
moderation_case_assignments	Moderator ownership periods for a case.	Links case, assignee and assigning user.	Restricted
moderation_actions	Immutable enforcement action with before and after state.	Links case, actor, policy and exactly one target.	Restricted
appeals	Appeal and resolution tied to the original action.	Links action, appellant and resolver.	Restricted
Notifications audit and event delivery
Table	Primary responsibility	Key relationships	Data class
notification_preferences	Channel and category consent, with security notices protected.	Belongs to a user.	Confidential
notifications	Localized notification intent and authorized deep-link target.	Belongs to a recipient user.	Confidential
notification_deliveries	Per-channel queue, retry and engagement state.	Belongs to one notification.	Internal
marketplace_audit.audit_log	Append-only security and material change record.	Links actor, session, target and request correlation.	Restricted
marketplace_audit.domain_event_outbox	Transactional events for jobs and integrations.	References an aggregate by stable identifier.	Internal
marketplace_audit.analytics_event_outbox	Validated product-event envelope without sensitive content.	Carries approved resource and segmentation identifiers.	Internal
Appendix C Change record
Version	Date	Status	Summary
1.0	18 September 2026	Ready for implementation	Initial PostgreSQL and PostGIS model derived from the approved Product Specification V2. Includes full-scope domain tables, constraints, ERDs, privacy boundaries, event outboxes and solo-human-plus-AI operating controls.
Approval record
Role	Decision	Date	Record
Product owner	Product Specification V2 approved; proceed to data model and implementation.	18 September 2026	Project conversation approval.
Technical implementation owner	Pending migration execution against PostgreSQL and CI validation.		Complete during architecture foundation.

