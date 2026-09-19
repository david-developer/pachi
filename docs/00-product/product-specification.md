



Cameroon Housing Marketplace Product Specification V2
Product rules, marketplace operations and release requirements
Version 2.0
18 September 2026
Status: Draft for product, design, engineering and operations approval.
This specification replaces the role-based and property-only assumptions in Version 1 with a claim-based trust model, separate Property and Listing records, organization-aware permissions, viewing interactions and measurable release gates.
Launch scope
Initial operating regions: Southwest and Littoral. Other regions remain available for preregistration until activated.
Initial languages: English and French architecture from the first release.
 
Document control
Item	Definition
Purpose	Define the product rules that design, engineering, moderation, support and analytics must implement consistently.
Audience	Product owners, designers, engineers, technical leads, moderators, support leads, analysts and implementation partners.
Authority	This document becomes the product source of truth after approval. Conflicts should be resolved through recorded change control.
Scope	Mobile marketplace, provider and organization capabilities, admin operations, core backend rules, analytics and release readiness.
Out of scope	Detailed database DDL, API payload schemas, high-fidelity visual design, legal opinions and vendor contracts.
Supersedes	Cameroon Housing Marketplace Product Specification Version 1.0 after formal approval.

How to read this specification
Each requirement uses one of three decision states. A confirmed decision should be implemented unless a later approved change replaces it. A proposed rule is the recommended default and requires owner approval. A future capability must not enter the MVP unless the scope is formally changed.
Decision state	Meaning
Confirmed	Agreed product direction for V2.
Proposed	Recommended detail that should be approved or revised before implementation.
Future	Designed for compatibility but excluded from the core MVP.

Requirement IDs remain stable. If a requirement changes, update its text and decision history instead of renumbering unrelated requirements.
Contents
1.  Product definition and outcomes
2.  Users and account model
3.  Providers and provider accounts
4.  Organizations and memberships
5.  Permission architecture
6.  Verification levels and claims
7.  Properties and property authority
8.  Listings and publication
9.  Offerings and commercial terms
10.  Discovery saved content and offline behavior
11.  Communication and inquiries
12.  Viewing interactions
13.  Reviews and reputation
14.  Trust safety moderation and audit
15.  Notifications and communication preferences
16.  MVP scope and acceptance criteria
17.  Analytics and marketplace measurement
18.  Security reliability and technical baseline
19.  Delivery sequence and release gates
20.  Risks open decisions and change control
21.  Appendix A Lifecycle reference
22.  Appendix B Permission reference
23.  Appendix C Analytics event reference
 
1 Product definition and outcomes
Confirmed  The product is a mobile-first housing marketplace for Cameroon. It connects people seeking homes with accountable property providers and gives platform operators the tools to verify claims, moderate inventory and measure marketplace completion.
1.1 Product problem
Property discovery often depends on scattered social posts, informal referrals and listings with inconsistent pricing, location and availability. Seekers cannot reliably judge whether a provider is real or whether a listing is current. Providers lack a structured channel for presenting inventory, handling inquiries and building accountable marketplace history.
The product must improve useful discovery and trusted contact. Registration volume and app downloads are supporting indicators, not the primary definition of success.
1.2 Product outcomes
•	A seeker can find relevant, current inventory and contact the responsible provider with clear trust signals.
•	A legitimate owner, agent or property manager can publish structured inventory after the required verification and moderation checks.
•	A viewing can be requested, scheduled and completed in a way that creates measurable marketplace history.
•	Reviews arise from eligible interactions rather than open, anonymous opinion.
•	Moderators can investigate reports, apply scoped actions and reconstruct important decisions from audit records.
•	The product team can measure search usefulness, contact, viewing progression, provider responsiveness, inventory freshness and fraud outcomes.
1.3 Launch market and languages
Area	V2 decision
Initial service regions	Southwest and Littoral.
Other regions	Visible in the location model and available for preregistration, but not open for publishing until activated.
Languages	English and French localization architecture from the beginning. User-generated content is not automatically translated in MVP.
Currency	XAF is the launch default. Money storage must remain currency-aware.
Platforms	Android and iOS mobile application, plus a responsive web admin application.

1.4 Product principles
•	Trust claims must be specific. Identity verification does not prove property ownership or agent authority.
•	Physical properties, advertisements and commercial terms are separate records.
•	Browse access stays open. Higher-risk actions require progressively stronger verification.
•	The admin application is part of the product, not an afterthought.
•	Paid visibility never bypasses listing eligibility, moderation or safety rules.
•	The MVP should be narrow enough to operate well under real connectivity, support and moderation constraints.
•	Server-side authorization is authoritative. The client interface may explain permissions but cannot grant them.
1.5 Core terminology
Term	Definition
User	A real account holder and security principal.
Seeker	A user capability for discovering and pursuing a property.
Provider profile	A user capability for acting as an owner, independent agent or property manager.
Provider account	The individual or organization publicly responsible for a listing.
Property	The real-world physical asset.
Listing	A marketplace advertisement for a property.
Offering	The commercial terms attached to a listing, such as rent, sale price or nightly rate.
Interaction	The marketplace relationship between a seeker, a provider account and a listing.
Verification	A platform decision about a specific claim and its supporting evidence.

2 Users and account model
Confirmed  A user account is not permanently locked to one marketplace role. One person may seek a property, own property and act as an agent at different times.
2.1 User capabilities
Capability	Eligibility	Primary actions
Anonymous visitor	No account	Browse public listings, search and view public provider information.
Registered user	Phone OTP complete	Manage profile, save listings, start eligible interactions and manage preferences.
Seeker	Active user account	Message providers, request viewings, review eligible marketplace events and report abuse.
Provider	Active provider profile and required verification	Create property records and listing drafts; publish when relationship and moderation rules pass.
Organization member	Active membership	Act within the organization permissions and resource assignments granted to the member.
Platform staff	Explicit administrative assignment	Perform only the privileged actions granted by the administrative permission set.

2.2 Account lifecycle
State	Meaning	Allowed behavior
PENDING_PHONE	Registration started but phone ownership is not confirmed.	Complete OTP only.
ACTIVE	Account may use capabilities for which it is eligible.	Normal access subject to verification and resource policy.
LIMITED	Selected actions are restricted because of risk, policy or incomplete remediation.	Browse and approved low-risk actions only.
SUSPENDED	Marketplace activity is temporarily blocked by an authorized action.	Appeal/support access and permitted read-only access.
DEACTIVATED	User voluntarily paused the account.	Reactivation flow only, subject to policy.
DELETION_PENDING	Deletion request is inside its waiting and retention process.	No new marketplace activity.
DELETED	Account is no longer available to the user; retained records follow legal, safety and audit policy.	None.

2.3 Profile and privacy rules
ID	Requirement	Acceptance evidence
USR-001	Use an immutable internal identifier and a canonical E.164 phone number.	Duplicate phone registration is prevented and phone changes require reverification.
USR-002	Keep public display data separate from private legal identity data.	Public APIs never return legal identity fields unless the current user is entitled to them.
USR-003	Store preferred language, region, city and notification preferences without exposing sensitive housing preferences publicly.	Profile responses contain only the approved public fields.
USR-004	Keep account status separate from every verification status.	Changing a verification record cannot silently overwrite account status.
USR-005	Support one user holding seeker, provider and organization capabilities at the same time.	Role switching does not create duplicate user accounts or lose history.
USR-006	Record account-state changes in the audit log.	Each state change identifies actor, reason, target and timestamp.

3 Providers and provider accounts
Confirmed  ProviderProfile describes a person's marketplace capability. ProviderAccount describes the individual or organization that accepts public responsibility for a listing.
3.1 Provider types
Type	Definition	Publishing implication
OWNER	A person advertising property they own or control.	Creates an owner relationship to each property; authority may be declared or verified.
INDEPENDENT_AGENT	A person acting for a property owner outside an organization.	Must declare the principal relationship and may submit authority evidence.
PROPERTY_MANAGER	A person managing a property for an owner.	Must create a management relationship and observe any validity period.
ORGANIZATION	An agency, management company or corporate owner represented by authorized members.	The organization provider account owns listings; members act through scoped permissions.

3.2 Provider lifecycle
State	Entry condition	Effect
DRAFT	Provider profile started.	May edit profile but cannot publish.
PENDING_VERIFICATION	Required evidence submitted.	May create drafts if policy permits; cannot publish.
ACTIVE	Verification and account rules pass.	May perform provider actions within resource permissions.
RESTRICTED	A limited sanction or remediation requirement applies.	Only explicitly permitted actions remain.
SUSPENDED	Serious or repeated policy action.	Provider publishing and interaction actions are blocked.
CLOSED	Provider capability ended.	Historical records remain; no new provider activity.

3.3 Provider account rules
ID	Requirement	Acceptance evidence
PRV-001	Every listing must reference exactly one responsible ProviderAccount.	Published listing responses show the responsible provider and applicable trust claims.
PRV-002	An individual provider account must reference one active ProviderProfile.	The account cannot remain publishable when the profile is suspended or closed.
PRV-003	An organization provider account must reference one active Organization.	Publishing fails when the organization is suspended or the actor lacks an active membership.
PRV-004	Provider response rate and median response time are derived metrics, not editable profile fields.	Only analytics jobs or authorized system processes update these metrics.
PRV-005	Provider type does not by itself prove authority over a property.	Publication policy evaluates a separate ProviderPropertyRelationship.

4 Organizations and memberships
Confirmed  Organizations are first-class marketplace principals. A user joins through a membership record rather than a direct organization identifier on the user account.
4.1 Supported organization types
Type	Use
REAL_ESTATE_AGENCY	Agency representing properties through agents or listing managers.
PROPERTY_MANAGEMENT_COMPANY	Company managing properties and provider communications.
CORPORATE_PROPERTY_OWNER	Business that owns and advertises its own inventory.
OTHER_APPROVED_PROVIDER	Exception category enabled only through administrative approval.

4.2 Membership roles
Role	Default scope	Restrictions
OWNER	Organization settings, members, inventory and delegated authority.	Protected actions may require step-up authentication or a second owner.
ADMIN	Members, listings and operational settings.	Cannot transfer ownership unless separately permitted.
LISTING_MANAGER	Organization inventory and listing workflow.	No access to identity evidence or admin permissions.
AGENT	Assigned listings and interactions.	No automatic access to all organization resources.
ANALYST	Approved aggregate analytics.	Read-only and no access to private messages or identity evidence.

4.3 Membership lifecycle and controls
State	Rule
INVITED	The invitation has a defined recipient, inviter and expiry.
ACTIVE	The member may act within role and resource assignment.
SUSPENDED	Access is temporarily blocked without deleting historical responsibility.
REVOKED	Future access ends; previous activity remains attributable.

ID	Requirement	Acceptance evidence
ORG-001	An organization must maintain at least one active owner or an explicit recovery path.	The final owner cannot remove themselves without transferring control or completing recovery.
ORG-002	Membership changes must identify the inviter or actor and effective time.	Audit entries exist for invitations, acceptance, role changes, suspension and revocation.
ORG-003	Listing access must combine membership role with assignment or organization-wide scope.	An agent cannot update an unassigned listing unless their role grants organization-wide access.
ORG-004	Organization verification is separate from member identity verification.	The UI presents distinct business and individual trust claims.

5 Permission architecture
Confirmed  Authorization uses role-based permissions plus resource-level policy. A role answers what an actor may attempt; the resource policy decides whether the actor may act on this object now.
5.1 Authorization evaluation
1.  Authenticate the actor and session.
2.  Confirm the user and relevant provider, organization or admin account states.
3.  Check that the role grants the requested permission.
4.  Check resource ownership, organization membership, assignment and verification requirements.
5.  Check moderation holds, blocking relationships and other policy conditions.
6.  Allow or deny on the server and record sensitive decisions when required.
5.2 Marketplace permission matrix
Action	Anonymous	Phone verified	Verified provider	Organization member	Moderator
Browse public listings	Allow	Allow	Allow	Allow	Allow
Save listing	Deny	Allow	Allow	Allow	Allow
Message provider	Deny	Allow	Allow	Allow	Scoped
Request viewing	Deny	Allow	Allow	Allow	Deny
Create listing draft	Deny	Deny	Own account	If role permits	Scoped
Submit for review	Deny	Deny	Own account	If role permits	Scoped
Publish listing	Deny	Deny	After checks	After checks	Moderation scope
Edit listing	Deny	Deny	Own account	Assigned or org scope	Scoped
Submit review	Deny	Eligible event	Eligible event	Eligible event	Deny
Suspend user	Deny	Deny	Deny	Deny	Explicit permission

5.3 Permission catalog
Domain	Representative permissions
Listings	listing:create, listing:submit, listing:update:own, listing:update:organization, listing:moderate, listing:hide, listing:remove
Providers	provider:manage:own, provider:verify, provider:restrict
Organizations	organization:update, organization:invite_member, organization:assign_listing, organization:verify
Interactions	interaction:create, interaction:message, viewing:request, viewing:respond, viewing:complete, viewing:dispute
Reviews	review:create, review:update_window, review:report, review:moderate
Trust and safety	report:create, report:triage, case:assign, moderation:act, appeal:resolve
Administration	user:read, user:restrict, user:suspend, audit:read, admin:permissions_manage

ID	Requirement	Acceptance evidence
PERM-001	All sensitive authorization decisions must run on the backend.	Direct API calls cannot bypass a disabled client control.
PERM-002	Administrative roles follow least privilege.	Support staff cannot access identity evidence or grant admin permissions without explicit rights.
PERM-003	Authorization failures return a stable reason category without disclosing sensitive policy data.	Clients can present corrective guidance while internal rules remain protected.
PERM-004	Permission changes and denied privileged actions are auditable where security policy requires.	Audit records identify actor, permission, resource and request correlation identifier.

6 Verification levels and claims
Confirmed  Verification is claim-based. The platform displays which claim was checked instead of compressing all trust into one ambiguous badge.
6.1 Operational access tiers
Tier	Minimum claim	Capabilities unlocked	Public presentation
T0 Browse	None	Public search and listing detail.	No badge.
T1 Account	PHONE_OWNERSHIP verified	Save, communicate, request viewing and report.	Phone confirmed where appropriate; not a provider badge.
T2 Provider	PROVIDER_IDENTITY verified	Submit provider listings for moderation.	Identity verified provider.
T3 Organization	BUSINESS verified for organization	Organization publishing and verified business profile.	Verified organization.

Property authority is an independent listing-level claim. A T2 or T3 provider may hold a DECLARED, PENDING, VERIFIED, REJECTED, EXPIRED or REVOKED relationship to a specific property. Only VERIFIED authority may display a property-authority badge.
6.2 Verification types and subjects
Verification type	Subject	What it proves	What it does not prove
PHONE_OWNERSHIP	User	Control of the phone during verification.	Legal identity or property authority.
IDENTITY	User	Identity evidence passed the platform review.	Provider legitimacy or ownership.
PROVIDER_IDENTITY	Provider profile	The provider identity review passed.	Authority over every advertised property.
BUSINESS	Organization	The organization evidence passed the business review.	Truth of every listing.
PROPERTY_AUTHORITY	Provider-property relationship	Submitted evidence supports the claimed relationship.	Title quality, transaction safety or future availability.

6.3 Verification lifecycle
State	Meaning	Permitted transition
NOT_STARTED	No active submission.	PENDING
PENDING	Evidence is awaiting review.	VERIFIED, REJECTED, NEEDS_RESUBMISSION
NEEDS_RESUBMISSION	Correctable evidence issue.	PENDING
VERIFIED	Claim approved for its validity period.	EXPIRED, REVOKED
REJECTED	Claim failed current policy.	PENDING only through a new or appealed submission
EXPIRED	Validity period ended.	PENDING
REVOKED	Approval withdrawn because the claim or evidence is no longer valid.	PENDING only if policy allows

ID	Requirement	Acceptance evidence
VER-001	Sensitive evidence must use private object storage and short-lived protected access.	Ordinary application endpoints never expose evidence storage keys or public URLs.
VER-002	Every manual decision must identify reviewer, time, reason code and applicable policy version.	Verification history can be reconstructed without relying on mutable notes.
VER-003	The system must support evidence retention and deletion schedules by evidence type.	Expired retention dates produce controlled deletion without removing the verification decision record.
VER-004	Public badges must map to current verification records and expire or disappear when claims expire or are revoked.	Badge state changes without editing the public profile manually.
VER-005	Provider publishing requires the approved verification policy for the provider type.	Submission or publication fails with a corrective reason when the requirement is not met.

7 Properties and property authority
Confirmed  Property represents the physical asset. It persists when advertisements, prices, availability or responsible providers change.
7.1 Property fields
Field group	Required or conditional data
Identity	Immutable identifier, property type and internal record status.
Structured location	Region, city or municipality, neighborhood or area, local landmark and optional coordinates.
Address privacy	Private exact address plus public precision level: neighborhood, approximate or exact.
Physical specifications	Bedrooms, bathrooms, living rooms, size when known, floor, building floors, furnishing and condition.
Amenities	Controlled amenity references with localized display labels.
Media	Object-storage references, sort order, dimensions, processing state and content hash.
Provenance	Creator, created time, update time and version.

7.2 Property record states
State	Use
ACTIVE	Current canonical property record.
POSSIBLE_DUPLICATE	Flagged for review but not yet merged.
MERGED	Redirects to a canonical property record while preserving history.
ARCHIVED	No current marketplace use but retained for history.
REMOVED	Unavailable because of policy, privacy or data-quality action.

7.3 Provider property relationship
Field	Rule
relationship_type	OWNER, AUTHORIZED_AGENT or PROPERTY_MANAGER.
authorization_status	DECLARED, PENDING, VERIFIED, REJECTED, EXPIRED or REVOKED.
validity	Optional valid_from and valid_until dates.
verification	Optional link to the evidence-backed PROPERTY_AUTHORITY verification.
revocation	Revocation time, actor and reason; dependent listings are reevaluated.

ID	Requirement	Acceptance evidence
PROP-001	A property record must not contain listing price, publication status or provider-specific marketing copy.	The same property supports multiple historical listings without overwriting the asset record.
PROP-002	Public location responses must obey the listing and property precision policy.	Anonymous users cannot infer the private address from API fields or map coordinates.
PROP-003	Media processing must generate optimized derivatives and preserve hashes for duplicate analysis.	A failed upload does not become publicly visible; successful media includes dimensions and processing status.
PROP-004	Moderators must be able to merge duplicate property records without losing listings, relationships or audit history.	Merged records resolve to one canonical property.
PROP-005	A listing submission must reference a current provider-property relationship.	Submissions without a relationship fail before moderation.

8 Listings and publication
Confirmed  Listing is the advertisement. It has independent publication, market and moderation states so the product does not overload one generic status field.
8.1 Listing fields
Group	Fields
References	property_id, provider_account_id, provider_property_relationship_id, created_by_user_id.
Presentation	purpose, title, description, selected media and public location precision.
Lifecycle	publication_status, market_status, moderation_status and state timestamps.
Freshness	last_confirmed_at, expires_at and reminder state.
Control	version for optimistic concurrency, created_at, updated_at and archive/removal metadata.

8.2 Publication lifecycle
State	Meaning	Main exits
DRAFT	Provider is preparing the listing.	PENDING_REVIEW or ARCHIVED
PENDING_REVIEW	Moderation checks are in progress.	PUBLISHED, REJECTED or DRAFT for correction
REJECTED	Submission failed with a reason and remediation path.	DRAFT or ARCHIVED
PUBLISHED	Visible in discovery if market and moderation rules permit.	PAUSED, EXPIRED, ARCHIVED, HIDDEN or REMOVED
PAUSED	Provider temporarily removed listing from discovery.	PUBLISHED or ARCHIVED
EXPIRED	Freshness period ended.	PENDING_REVIEW, PUBLISHED after renewal, or ARCHIVED
ARCHIVED	Provider ended the advertisement.	New listing version or approved republish flow
HIDDEN	Platform temporarily suppressed visibility.	PUBLISHED or REMOVED
REMOVED	Platform ended visibility because of policy or safety action.	Appeal outcome only

8.3 Market and moderation states
Purpose	Market states
Rent	AVAILABLE, UNDER_OFFER, RENTED, TEMPORARILY_UNAVAILABLE
Sale	AVAILABLE, UNDER_OFFER, SOLD
Short let	AVAILABLE, PARTIALLY_BOOKED, UNAVAILABLE

Moderation status is separate: NOT_REVIEWED, IN_REVIEW, APPROVED, CHANGES_REQUIRED, REJECTED, ESCALATED or REMOVED. Search visibility requires a publishable combination, normally publication_status PUBLISHED, moderation_status APPROVED and a discoverable market status.
8.4 Minimum publishability rules
ID	Requirement	Acceptance evidence
LIST-001	A listing must reference a valid property, provider account, provider-property relationship and purpose-specific offering.	Submission validates all four references in one transaction.
LIST-002	Required fields include purpose, property type, price, structured location, key specifications, availability and at least one approved image.	Incomplete listings show field-level correction messages and cannot enter review.
LIST-003	Publication requires the provider verification policy and listing moderation approval.	A client cannot set PUBLISHED directly.
LIST-004	Price, provider, authority, location precision and material property changes trigger a recorded revision and may require renewed moderation.	Policy-defined changes move the listing to the correct review state.
LIST-005	Listings must expire or require freshness confirmation on a configurable schedule.	Stale listings stop ranking or leave discovery according to policy.
LIST-006	Sponsored placement must be labeled and may rank only among eligible listings.	A hidden, rejected, expired or unavailable listing cannot be promoted.

9 Offerings and commercial terms
Confirmed  Commercial terms belong to an Offering attached to a Listing, never to the physical Property.
9.1 Base offering
Field	Rule
currency	ISO currency code. Launch default is XAF.
price_amount	Numeric decimal or minor-unit value; never formatted text.
pricing_period	MONTHLY, NIGHTLY, WEEKLY, TOTAL or another controlled purpose-compatible value.
negotiable	Boolean display and filter value.
effective dates	Commercial terms retain version history when material values change.

9.2 Purpose specific terms
Offering	MVP fields	Later-compatible fields
Rental	Monthly rent, deposit, advance months, minimum lease, available from, utilities and service charge.	Lease application, agreements, recurring payments and maintenance.
Sale	Sale price, negotiable indicator and available from.	Financing indicators, richer legal records and transaction workflow.
Short let	Nightly price, optional weekly price, minimum stay, guest limit, check-in, check-out and optional cleaning fee.	Calendar inventory, booking, cancellation, payments and commission.

ID	Requirement	Acceptance evidence
OFFR-001	One active listing has exactly one purpose-compatible active offering.	A rent listing cannot save short-let-only fields as its active terms.
OFFR-002	Changing material commercial terms creates history and an analytics event.	Previous price and effective time remain available to authorized services.
OFFR-003	The public display uses localized formatting while filters use normalized numeric values.	Sorting and price filters operate on numbers, not formatted strings.
OFFR-004	Payments and booking state are excluded from core MVP.	No interface implies platform custody, escrow or confirmed booking before those domains are released.

10 Discovery saved content and offline behavior
10.1 Search and filters
Confirmed  MVP discovery uses structured filters and list results. Map results, saved-search alerts and compare are early releases unless capacity and readiness gates permit inclusion.
•	Search by supported region, city or municipality, neighborhood or area, landmark aliases and approved keywords.
•	Filter by purpose, property type, price range, bedrooms, bathrooms, furnishing, amenities and availability.
•	Sort by relevance, newest and price. Distance is enabled only when coordinate quality and location permission support it.
•	Show price, public location, core specifications, provider trust claim, freshness and sponsored label on result cards.
•	Return a useful empty state with nearby or relaxed-filter alternatives without silently changing the query.
10.2 Ranking policy
Organic ranking should consider query match, location match, listing completeness, freshness, availability and quality signals. Paid promotion may apply a disclosed boost only after organic eligibility and safety checks. Risk signals may suppress or hold a listing even when the provider has paid for promotion.
10.3 Saved and offline content
ID	Requirement	Acceptance evidence
DISC-001	Phone-verified users can save and unsave listings idempotently.	Repeated save requests do not create duplicates.
DISC-002	Saved listings include an offline cache of core detail and optimized media within a bounded storage policy.	The saved item opens without network and shows its last synchronized time.
DISC-003	Offline content must disclose that availability and price may be stale.	The interface never presents cached availability as current.
DISC-004	Network-required actions remain disabled or queued with a clear state.	Messages, reports and viewing requests are not falsely marked as sent while offline.
DISC-005	Search analytics distinguish zero inventory from technical failure.	Dashboard metrics do not count failed requests as zero-result searches.

11 Communication and inquiries
Confirmed  A listing inquiry creates or reuses an Interaction, then attaches a one-to-one Conversation. The Interaction is the business context; the Conversation contains messages.
11.1 Interaction identity
The normal uniqueness rule is one open interaction for a seeker, provider account and listing combination. A later interaction may be created after closure if policy permits, but history is not overwritten.
11.2 Conversation and message behavior
Capability	Core MVP	Early release
Text messages	Send, receive, timestamp, deliver, read, paginate and notify.	Message attachments after abuse and storage controls are ready.
Voice messages	Excluded from core gate.	Record, upload, transcode, play, report and retain under policy.
Direct call	Open the device dialer using the permitted provider phone number.	Call masking or VoIP only after privacy, cost and reliability review.
Block and report	Available from conversation and provider surfaces.	Automated risk detection after enough validated signals exist.

ID	Requirement	Acceptance evidence
COMM-001	Only conversation participants and explicitly authorized safety staff can access conversation data.	Changing a conversation identifier cannot expose another user's messages.
COMM-002	Message send operations enforce account state, block relationships and rate limits.	Blocked or suspended actors cannot continue messaging.
COMM-003	A native call action records the marketplace intent event but does not claim the call connected.	Analytics distinguishes call_tapped from any later confirmed interaction.
COMM-004	Reported message content is preserved according to the safety retention policy.	Deleting a message from the user view does not erase evidence required by an active case.
COMM-005	The application must handle provider, listing or account removal without corrupting history.	The conversation displays a controlled unavailable state and stops prohibited actions.

12 Viewing interactions
Confirmed  Viewing is the first structured marketplace completion event and is more important to core MVP than voice messaging, compare or promotion.
12.1 Viewing lifecycle
State	Who may set it	Required behavior
REQUESTED	Eligible seeker	Proposed date or scheduling request is recorded.
ACCEPTED	Authorized provider	Provider agrees to proceed; details may still need confirmation.
SCHEDULED	System after required confirmations	Time and safe location instructions are available to both parties.
RESCHEDULED	Either party with policy checks	Previous schedule remains in history.
CANCELLED_BY_SEEKER	Seeker	Reason category and time recorded.
CANCELLED_BY_PROVIDER	Provider actor	Reason category and time recorded.
SEEKER_NO_SHOW	Provider claim, subject to dispute	Counterparty may confirm or dispute.
PROVIDER_NO_SHOW	Seeker claim, subject to dispute	Counterparty may confirm or dispute.
COMPLETED	Confirmation rule satisfied	May create review eligibility.
DISPUTED	Either party or moderator	Review eligibility is held until resolved.

12.2 Completion and safety rules
ID	Requirement	Acceptance evidence
VIEW-001	A viewing belongs to one Interaction and inherits its listing, seeker and provider context.	Viewing creation cannot substitute unrelated identifiers.
VIEW-002	Both parties receive reminders and can cancel or request rescheduling before the appointment.	Notification history and final state remain consistent.
VIEW-003	Completion normally requires both parties to confirm, or one confirmation plus expiry of an uncontested response window.	The system does not create eligibility immediately from an unconfirmed single claim.
VIEW-004	No-show claims permit counterparty confirmation or dispute.	A disputed no-show does not affect public reputation until resolved.
VIEW-005	Exact private location instructions are visible only after the configured scheduling condition.	Public and unauthorized APIs never expose viewing instructions.
VIEW-006	A completed viewing creates review eligibility according to policy.	Eligibility is idempotent and linked to the viewing event.

13 Reviews and reputation
Confirmed  Reviews require an eligible marketplace event. The system supports separate provider, seeker and property subjects and uses a double-blind publication window.
13.1 Review eligibility
Eligibility reason	MVP status	Subjects enabled
COMPLETED_VIEWING	Core MVP	Provider and seeker; property if the review policy approves a property-experience question set.
CONFIRMED_RENTAL	Future	Provider, seeker and property.
CONFIRMED_SHORTLET	Future	Provider, seeker and property.
CONFIRMED_TRANSACTION	Future	Provider, seeker and property.

13.2 Review criteria
Subject	Structured criteria
Provider	Listing accuracy, communication, reliability, transparency and overall experience.
Seeker	Communication, reliability, appointment attendance, respectful conduct and overall interaction.
Property	Accuracy of advertised physical characteristics and condition observed during the eligible event.

13.3 Double blind lifecycle
State	Meaning
ELIGIBLE	The review window is open but no review has been submitted.
SUBMITTED_HELD	A review is stored but not visible to the counterparty.
PUBLISHED	Both eligible counterparties submitted, or the review window expired.
REPORTED	A published or held review was reported.
UNDER_REVIEW	Moderation is assessing the report.
HIDDEN	Temporarily removed from public display.
REMOVED	Removed after a policy decision; audit history remains.

ID	Requirement	Acceptance evidence
REV-001	One eligibility record can be consumed once for the same author, subject and event.	Duplicate submissions return the existing result or a conflict without creating another review.
REV-002	A user cannot see the counterparty's held review before submitting or the review window closing.	API responses omit rating and text during the blind period.
REV-003	Review edits are limited to an approved time window and preserve edit history.	The published review shows the current version while moderators can inspect changes.
REV-004	Reviews must describe marketplace behavior and must not target protected or irrelevant personal characteristics.	Report and moderation reason codes include discrimination, harassment, privacy exposure and irrelevance.
REV-005	Reputation summaries are derived and recalculated from published eligible reviews.	Hidden or removed reviews stop contributing without deleting their records.
REV-006	No-show counts and completed interactions remain separate from the star rating.	The public interface does not disguise operational history as subjective review score.

14 Trust safety moderation and audit
Confirmed  A user Report is an allegation. A ModerationCase is the platform investigation. Multiple reports may attach to one case, and every material intervention creates a ModerationAction and AuditLog entry.
14.1 Report targets and lifecycle
Reports may target a user, provider, organization, property, listing, review, message or interaction. The lifecycle is SUBMITTED, TRIAGED, IN_REVIEW, RESOLVED or DISMISSED, then CLOSED. Severe items may enter ESCALATED at any point.
Severity	Example handling
LOW	Queue for normal review; no automatic public action.
MEDIUM	Prioritized review; preserve evidence and evaluate related history.
HIGH	Immediate triage; temporary content hold may be applied under policy.
CRITICAL	Immediate escalation and protective action by authorized staff.

14.2 Administrative roles
Role	Core scope	Explicit exclusions
SUPER_ADMIN	Platform configuration and privileged role management.	Routine use should be minimized and strongly authenticated.
VERIFICATION_OFFICER	Review permitted verification evidence and decisions.	No automatic access to all messages or admin-role management.
LISTING_MODERATOR	Review listings, duplicates and listing reports.	No identity-evidence access unless separately granted.
TRUST_SAFETY_MODERATOR	Reports, cases, reviews, abuse evidence and sanctions.	No permission administration by default.
SUPPORT_AGENT	User support and approved low-risk account assistance.	No unrestricted evidence, message or suspension access.
ANALYST	Approved aggregate operational and marketplace analytics.	No raw identity evidence and no moderation actions.

14.3 Moderation actions
Supported actions include warning issuance, listing hide or removal, review hide or removal, user restriction or suspension, verification revocation, provider-property relationship revocation and case closure. Each action carries a reason code, actor, target, case link, timestamp and internal notes where permitted.
ID	Requirement	Acceptance evidence
SAFE-001	Material moderation actions must be immutable from the application perspective.	Corrections are represented by a new action rather than overwriting the original.
SAFE-002	Case access must be restricted by role and assignment.	A moderator without case permission cannot open its protected evidence.
SAFE-003	The system must preserve request correlation and before/after state for critical changes.	Investigators can connect the user action, moderation action and resulting state change.
SAFE-004	Appeals must be linkable to the original action and resolved by an authorized role.	An appeal cannot silently erase the original decision.
SAFE-005	Risk signals inform review but do not become public reputation scores.	Users see specific enforcement or verification results, not an opaque internal risk score.
SAFE-006	The admin dashboard must surface queue age, assignment, severity and action history.	Operations can identify unowned or overdue cases.

15 Notifications and communication preferences
Confirmed  Push notifications support transactional marketplace events. Promotional notifications require separate consent and frequency control.
Notification group	Core events
Account and verification	OTP, verification submitted, approved, rejected, resubmission required, suspension and appeal status.
Listings	Submission received, changes required, published, freshness reminder, expired, hidden or removed.
Interactions	New message, viewing requested, accepted, rescheduled, cancelled, reminder, completion confirmation and dispute.
Reviews	Eligibility opened, review window reminder, publication and moderation outcome.
Discovery	Saved-search and price/status alerts in an early release.
Marketing	Separate opt-in campaigns with unsubscribe controls.

ID	Requirement	Acceptance evidence
NOTIF-001	Users can manage channel and category preferences except required security notices.	Disabling marketing does not disable OTP or critical account notices.
NOTIF-002	Notifications must deep-link only to resources the recipient may access.	A stale or forwarded notification cannot bypass authorization.
NOTIF-003	Delivery jobs must be idempotent and retry safely.	Retries do not generate uncontrolled duplicates.
NOTIF-004	Notification analytics distinguish generated, delivered, opened and acted upon.	Dashboards do not equate generation with successful delivery.

16 MVP scope and acceptance criteria
Confirmed  Industry-grade MVP means the selected marketplace loop works reliably and safely. It does not mean shipping every planned feature.
16.1 Core MVP
Capability	Scope	MVP meaning
Browse without account	Core	Public listing discovery and details.
English and French architecture	Core	All product strings use localization keys; launch content is prepared in both languages.
Phone OTP and accounts	Core	Registration, sessions, recovery and account states.
Seeker capability	Core	Save, contact, request viewing, review eligible events and report.
Owner agent manager distinction	Core	Provider types and provider accounts.
Provider identity verification	Core	Manual operational workflow and protected evidence.
Optional seeker identity verification	Core architecture	Supported claim, not a universal browse requirement.
Organizations and memberships	Core data model	Minimum agency publishing and scoped member access.
Structured properties and listings	Core	Separate asset, advertisement and offering records.
Rent sale short let architecture	Core	Purpose-specific offerings; booking excluded.
Listing moderation	Core	Submission, review, correction, publish, hide and remove.
Photo upload and processing	Core	Optimized media and private upload controls.
Search and filters	Core	List discovery for launch regions.
Saved and offline listings	Core	Bounded cache with freshness disclosure.
Text messaging and native call	Core	Interaction-based communication.
Viewing interactions	Core	Request through completion, cancellation, no-show and dispute.
Two-sided reviews	Core	Eligibility and double-blind publication.
Report and block	Core	User, listing, message and review safety actions.
Push notifications	Core	Transactional events and preferences.
Admin portal and audit logs	Core	Verification, listing, reports, users, cases and actions.
Regional rollout controls	Core	Southwest and Littoral active; other regions preregister.

16.2 Early releases
Capability	Entry condition
Voice messages	Abuse reporting, media processing, retention and data-cost testing are ready.
Map results	Coordinate quality, privacy policy and map-provider performance are acceptable.
Saved-search alerts	Search quality and notification frequency controls are stable.
Compare	Core property data is consistent enough for meaningful comparison.
Promotions	Organic ranking, labeling, billing and safety suppression are ready.
Provider analytics	Metrics definitions and privacy controls are validated.

16.3 Later capabilities
Capability	Reason deferred
Payments and escrow	Legal, financial, reconciliation, dispute and security obligations.
Short-let booking engine	Calendar, cancellation, payment and operational support complexity.
Property ownership verification at scale	Evidence policy and local operating process require validation.
Automated identity verification	Vendor, coverage, cost and false-rejection validation.
AI recommendations	Requires reliable inventory, behavioral data and explainable safety controls.
VoIP and call masking	Telephony cost, privacy, reliability and support requirements.
Rental agreements and maintenance	Legal workflow and post-transaction operating model.

16.4 MVP completion criteria
•	A verified provider can complete the vertical slice from provider registration through listing publication.
•	A seeker can discover the listing, view trust information, create an interaction, message the provider and request a viewing.
•	Both parties can complete or dispute a viewing and receive the correct review eligibility.
•	A report can be triaged into a case, actioned by an authorized moderator and reconstructed from audit history.
•	Offline saved listings open with clear freshness information, and network-dependent actions do not appear completed while offline.
•	Analytics events support the approved marketplace funnel without exposing identity evidence or message content.
•	No unresolved release-blocking security, privacy, data-loss or authorization defect remains.
17 Analytics and marketplace measurement
Confirmed  The primary measurement system follows useful search, contact, viewing and trustworthy inventory rather than downloads or registrations alone.
17.1 North star and supporting measures
Proposed north-star measure: weekly completed or credibly progressed marketplace interactions. In the MVP this is the count of unique interactions that reach a validated viewing milestone, segmented by region and listing purpose. The team should validate the exact definition during the private pilot before using it for targets.
Metric	Definition
Useful search rate	Searches with at least one eligible result that receives a result view, listing view or filter refinement within the session.
Listing view to contact rate	Unique interactions initiated divided by unique eligible listing views.
Contact to viewing request rate	Interactions with a viewing request divided by interactions with contact.
Viewing acceptance rate	Accepted viewing requests divided by eligible viewing requests.
Viewing completion rate	Completed viewings divided by scheduled viewings that reached their appointment time.
Provider response rate	Eligible seeker contacts receiving a provider response within the policy window.
Median provider response time	Median time from eligible seeker contact to first provider response.
Active listing freshness	Share of published, discoverable listings confirmed inside the approved freshness window.
Verified provider share	Active provider accounts with current required verification divided by active provider accounts.
Confirmed fraud rate	Listings confirmed fraudulent divided by listings reviewed or active listings, reported with the denominator.

17.2 Event design
Events use stable names, actor and session identifiers, event time, product version, region, listing purpose and approved resource identifiers. Personal identity evidence, private addresses, message text and free-form moderation notes must not enter product analytics.
Domain	Core events
Acquisition and activation	registration_started, otp_verified, account_activated, provider_profile_started, provider_verified
Discovery	search_submitted, search_results_returned, result_clicked, listing_viewed, listing_saved, offline_listing_opened
Supply	property_created, listing_draft_created, listing_submitted, listing_published, listing_freshness_confirmed, listing_expired
Communication	interaction_created, message_sent, provider_first_response, call_tapped
Viewing	viewing_requested, viewing_accepted, viewing_scheduled, viewing_cancelled, viewing_completed, viewing_disputed
Reputation	review_eligibility_created, review_submitted, review_published, review_reported
Safety	report_submitted, case_opened, moderation_action_applied, appeal_submitted, case_closed

17.3 Analytics controls
ID	Requirement	Acceptance evidence
ANLY-001	Every funnel metric must publish its numerator, denominator, inclusion rules and time window.	Two dashboards cannot use the same name for different formulas.
ANLY-002	Client events must be validated and deduplicated before critical metrics use them.	Retries and offline sync do not inflate the funnel.
ANLY-003	Marketplace metrics must segment by region, city where safe, purpose, provider type and verification claim.	The team can distinguish liquidity problems from overall traffic changes.
ANLY-004	Operational dashboards must include queue age, listing freshness and provider responsiveness.	Operations can act before user-facing trust degrades.
ANLY-005	Analytics access follows role and privacy policy.	Identity evidence, private address and raw message content are excluded from product analytics.

18 Security reliability and technical baseline
Confirmed  The product starts as a modular monolith in one TypeScript monorepo. Mobile, admin and API share domain contracts without introducing premature microservices.
18.1 Technical baseline
Layer	Baseline
Mobile	React Native, Expo, TypeScript and Expo Router.
Admin	Next.js and TypeScript.
Backend	NestJS and TypeScript as a modular monolith.
Database	PostgreSQL with PostGIS.
Cache and jobs	Redis and BullMQ.
Storage	S3-compatible object storage with separate public and private access paths.
Mobile local storage	SQLite for saved/offline data and bounded synchronization.
Interfaces	REST with OpenAPI; WebSockets only where realtime behavior requires them.
Monitoring and analytics	Sentry and PostHog or approved equivalents.
Testing	Jest, Playwright and Maestro.
Delivery	GitHub Actions and EAS or approved equivalents.

18.2 Environments and data handling
Environment	Use	Data rule
LOCAL	Developer workstation and isolated local services.	Synthetic or approved test data only.
DEVELOPMENT	Shared integration and feature testing.	No production identity evidence.
STAGING	Release candidate, migration and operational rehearsal.	Production-like synthetic data; tightly controlled exceptions only.
PRODUCTION	Live marketplace.	Restricted access, audited operations and controlled migrations.

18.3 Security requirements
•	Encrypt data in transit and use platform-supported encryption at rest.
•	Store passwords only with an approved adaptive hash if password authentication is used.
•	Use short-lived access tokens, controlled refresh/session revocation and step-up authentication for sensitive admin actions.
•	Rate-limit OTP, registration, login, listing creation, messaging, review and report endpoints.
•	Use signed, short-lived access for private evidence and prevent storage references from reaching ordinary clients.
•	Separate secrets by environment and rotate them through controlled operations.
•	Log security-relevant changes without logging credentials, identity-document contents, private addresses or message bodies.
•	Run dependency, secret and authorization checks in continuous integration.
18.4 Proposed service targets
Proposed  These targets should be approved against budget and pilot load before they become contractual objectives.
Target	MVP objective
Availability	99.5 percent monthly availability for core API and admin moderation, excluding approved maintenance.
API latency	95th percentile under 800 ms for cached or indexed read endpoints at the agreed pilot load, excluding media transfer.
Crash-free mobile sessions	At least 99 percent during private pilot and MVP release window.
Recovery point	No more than 24 hours of database loss under the approved backup plan; improve for transaction domains later.
Recovery time	Restore core marketplace operations within 8 hours for the approved MVP incident class.
Media resilience	Retryable upload and processing with no public exposure before successful validation.

18.5 Accessibility and localization
ID	Requirement	Acceptance evidence
NFR-001	All interface copy must use localization keys and support text expansion.	English and French builds show no hard-coded production strings in core flows.
NFR-002	Interactive controls require accessible names, focus order, contrast and dynamic type support where the platform permits.	Automated checks and manual screen-reader tests pass the agreed core journeys.
NFR-003	Core flows must tolerate intermittent connectivity and safe retries.	Network loss does not duplicate listings, messages, viewing requests or moderation actions.
NFR-004	Database migrations run through controlled deployments and support rollback or forward repair.	No manual production schema editing is required for a normal release.

19 Delivery sequence and release gates
Confirmed  The team progresses through evidence-based gates. A later date does not override an unmet security, trust or marketplace-operability gate.
19.1 Delivery sequence
Stage	Primary output
1 Specification approval	Approved V2 decisions, owners, open decisions and change process.
2 Domain and schema validation	Relational schema, constraints, indexes, retention model and authorization design.
3 User journeys and design system	Complete seeker, provider, agency and moderator flows with documented component states.
4 Architecture foundation	Monorepo, environments, CI/CD, authentication, observability, migrations and API conventions.
5 Vertical slice	Provider registration to published listing to seeker inquiry through one working path.
6 Marketplace alpha	Messaging, viewing, reviews, reports, saves, offline behavior, notifications and admin tooling.
7 Private Cameroon pilot	Real provider and seeker use in Southwest and Littoral with hands-on operations.
8 MVP release	Public release after marketplace, safety and reliability gates pass.
9 Growth releases	Maps, voice, advanced alerts, promotions, deeper agency tools, payments and personalization.

19.2 Release gates
Gate	Pass condition	Evidence
G0 Specification approved	Product owner approves confirmed rules; engineering, design and operations accept responsibilities; critical open decisions have owners and deadlines.	Approved baseline and decision log.
G1 Architecture ready	Threat model, data classification, environments, migrations, CI, logging, secrets, backups and authorization test strategy are implemented.	Architecture review and automated pipeline evidence.
G2 Vertical slice complete	A verified provider can create, submit and publish; a seeker can search, view and inquire; moderators can review; all authorization checks run server-side.	End-to-end demonstration and passing automated tests.
G3 Alpha ready	Core MVP flows are feature-complete; analytics events validate; admin queues operate; no open critical security, data-loss or authorization defect.	Release checklist, test report and operations rehearsal.
G4 Private pilot ready	Seed inventory is publishable; moderators and support are staffed; incident, appeal and verification procedures are rehearsed; privacy and terms are approved.	Operational sign-off and pilot inventory report.
G5 MVP release ready	Pilot shows acceptable search usefulness, listing freshness, provider response and viewing progression against thresholds approved after alpha; reliability target is met; critical findings are closed.	Pilot scorecard and go or no-go record.
G6 Regional expansion ready	Launch regions show stable moderation load and inventory quality; the next region has provider supply, localized support and operational capacity.	Expansion readiness review.

19.3 Release blocking conditions
•	Any known path lets an unauthorized user view identity evidence, private addresses or another conversation.
•	A suspended or unverified provider can publish by calling the API directly.
•	Moderators cannot reconstruct a material verification, listing or sanction decision.
•	Critical data can be lost without a tested restore path.
•	Core analytics cannot distinguish system failures from zero inventory or user abandonment.
•	The operations team cannot process expected verification and report volume within the approved service policy.
•	Pilot users repeatedly encounter stale or fraudulent inventory without an effective correction process.
20 Risks open decisions and change control
20.1 Major risks
Risk	Product response
Fake or stolen listings	Provider verification, provider-property relationships, moderation, image hashes, duplicate review and reporting.
Low inventory density	Focused regional rollout, provider recruitment, preregistration and neighborhood-level inventory monitoring.
Stale listings	Freshness reminders, expiry, provider confirmation and visible last-confirmed information.
Retaliatory reviews	Eligible interactions, double-blind window, structured criteria, reporting and appeals.
Identity-data exposure	Private storage, least privilege, short-lived access, audit logs and retention controls.
Provider response failure	Response metrics, notifications, interaction closure and ranking/quality policy after validation.
Moderation overload	Scoped queues, severity, assignment, case grouping and launch-volume controls.
Monetization harms trust	Sponsored labels, eligibility-first ranking and no paid safety bypass.

20.2 Decisions requiring approval
Decision	Proposed default	Owner
Exact provider evidence for T2	Government ID plus selfie or approved equivalent, reviewed manually.	Product and Trust Safety
Seeker identity requirement	Optional claim; phone verification is sufficient for initial contact and viewing request unless risk policy requires step-up.	Product and Trust Safety
Property authority required for publication	A current declared relationship is sufficient for MVP; verified authority earns a separate badge. High-risk cases may require evidence.	Product and Operations
Listing freshness window	Configurable by purpose and region; approve after provider research and pilot behavior.	Product and Marketplace Operations
Review window length	Define before alpha and test notification timing in pilot.	Product and Trust Safety
Public phone visibility	Do not expose a reusable phone number until the approved contact action and privacy policy permit it.	Product and Privacy
Moderation and verification service times	Approve targets from pilot volume and staffing model.	Operations
Pilot success thresholds	Set after alpha instrumentation validates metric quality.	Product and Analytics
Map provider	Benchmark Cameroon coverage, geocoding quality, privacy, offline behavior and cost.	Engineering and Product
Identity evidence retention	Approve by evidence type after privacy and legal review.	Privacy and Trust Safety

20.3 Change control
1.  Record the requested change, reason, affected requirement IDs and requesting owner.
2.  Assess impact on user journeys, permissions, data model, security, moderation, analytics and release scope.
3.  Identify migration and compatibility requirements for existing records and clients.
4.  Obtain the required product, engineering, design, operations, privacy or trust approvals.
5.  Update this specification, decision log, acceptance tests and release plan in the same change.
6.  Communicate the effective version and do not rely on informal chat as the final source of truth.
 
Appendix A Lifecycle reference
Object	States
User	PENDING_PHONE, ACTIVE, LIMITED, SUSPENDED, DEACTIVATED, DELETION_PENDING, DELETED
Provider profile	DRAFT, PENDING_VERIFICATION, ACTIVE, RESTRICTED, SUSPENDED, CLOSED
Organization membership	INVITED, ACTIVE, SUSPENDED, REVOKED
Property	ACTIVE, POSSIBLE_DUPLICATE, MERGED, ARCHIVED, REMOVED
Provider property relationship	DECLARED, PENDING, VERIFIED, REJECTED, EXPIRED, REVOKED
Listing publication	DRAFT, PENDING_REVIEW, REJECTED, PUBLISHED, PAUSED, EXPIRED, ARCHIVED, HIDDEN, REMOVED
Listing moderation	NOT_REVIEWED, IN_REVIEW, APPROVED, CHANGES_REQUIRED, REJECTED, ESCALATED, REMOVED
Viewing	REQUESTED, ACCEPTED, SCHEDULED, RESCHEDULED, CANCELLED_BY_SEEKER, CANCELLED_BY_PROVIDER, SEEKER_NO_SHOW, PROVIDER_NO_SHOW, COMPLETED, DISPUTED
Review	ELIGIBLE, SUBMITTED_HELD, PUBLISHED, REPORTED, UNDER_REVIEW, HIDDEN, REMOVED
Verification	NOT_STARTED, PENDING, NEEDS_RESUBMISSION, VERIFIED, REJECTED, EXPIRED, REVOKED
Report	SUBMITTED, TRIAGED, IN_REVIEW, ESCALATED, RESOLVED, DISMISSED, CLOSED

 
Appendix B Permission reference
Administrative permission	Typical role	Resource condition
verification:read	Verification officer	Assigned queue or approved escalation.
verification:approve	Verification officer	Current evidence and policy version; actor cannot approve own submission.
listing:moderate	Listing moderator	Assigned queue or approved region scope.
listing:hide	Listing or safety moderator	Reason and case or policy action required.
report:triage	Safety moderator	Queue scope.
case:assign	Safety lead	Team and region scope.
review:moderate	Safety moderator	Report or case context.
user:restrict	Safety moderator	Approved sanction band and reason.
user:suspend	Safety lead or authorized admin	High-severity case and audit requirement.
organization:verify	Verification officer	Business evidence scope.
audit:read	Authorized lead or investigator	Purpose-limited and logged.
admin:permissions_manage	Super admin	Step-up authentication and protected audit.

 
Appendix C Analytics event reference
Event	Required properties	Metric use
search_submitted	search_id, region, purpose, filter_count	Search volume and refinement.
search_results_returned	search_id, eligible_result_count, latency_bucket, outcome	Useful search and technical health.
listing_viewed	listing_id, property_id, provider_account_id, source, region, purpose	View-to-contact funnel.
interaction_created	interaction_id, listing_id, seeker_user_id, provider_account_id, channel	Contact conversion.
provider_first_response	interaction_id, response_time_bucket	Provider response metrics.
viewing_requested	viewing_id, interaction_id, requested_time_bucket	Contact-to-viewing.
viewing_completed	viewing_id, interaction_id, confirmation_method	Marketplace completion.
review_published	review_id, eligibility_reason, subject_type	Reputation coverage.
listing_freshness_confirmed	listing_id, provider_account_id, previous_age_bucket	Inventory freshness.
report_submitted	report_id, target_type, reason_code, severity	Safety workload and report rate.
moderation_action_applied	case_id, action_type, target_type, reason_code	Enforcement outcomes.

Event properties shown here are the minimum product taxonomy. The implementation event contract should also include event time, source version, environment and approved correlation identifiers. It must exclude message bodies, identity-document data, private addresses and free-form moderator notes.
 
Approval record
This page records approval of the V2 baseline. Approval means the document may guide detailed design, schema and implementation. It does not replace required legal, privacy, security or vendor review.
Role	Name	Decision	Date
Product owner			
Engineering lead			
Design lead			
Marketplace operations lead			
Trust and safety lead			
Privacy or legal reviewer			

Version history
Version	Date	Summary
1.0	September 2026	Initial product vision and functional specification.
2.0 draft	18 September 2026	Introduces the provider and organization model, claim-based verification, separate property, listing and offering records, viewing interactions, eligibility-based reviews, permission boundaries, analytics definitions and release gates.

