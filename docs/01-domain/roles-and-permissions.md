# Pachi — Roles and Permissions

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and evaluation

Implements [product specification](../00-product/product-specification.md) and [domain model](domain-model.md). Authentication is not authorization. All decisions run on the server, including listing search/detail projections, media URLs and worker-triggered actions.

Evaluate in order: valid registered session; user/account state; actor role; responsible provider/organization state; ownership or active membership and assignment; current verification/authority; lifecycle and moderation restrictions; block relationships; required step-up. Deny by default. Cache invalidation must not permit revoked membership or sessions to continue acting.

Permissions use `domain:action[:scope]` identifiers. Clients may display a capability projection but cannot supply trusted roles, verification outcomes, organization ownership or authorization flags. Worker jobs act as a named system principal, recheck current state, and cannot restore expired rights.

## Account capabilities

| Actor | Allowed capabilities |
|---|---|
| Anonymous | Public list/detail/provider discovery and preregistration with consent/rate controls. No private phone, exact hidden address or evidence. |
| Authenticated PENDING_PHONE | Public browsing, own profile/contact setup, phone verification, recovery, support and own account controls. No marketplace participation. |
| Phone-verified ACTIVE user | Save/sync, create interaction, send allowed messages, request viewing, report/block and submit eligible reviews. Optional seeker identity verification is not universally required. |
| Individual provider | Own provider profile and drafts after phone verification. Submit/publish only with ACTIVE provider profile, verified PROVIDER_IDENTITY, current property relationship and full listing checks. |
| Organization member | Only role/assignment-scoped actions for that organization; never platform staff permissions. |
| LIMITED/SUSPENDED/deletion states | Only explicit low-risk reads, support, appeal, own data/privacy controls and safe cancellation. No publication, new contact or reviews unless policy explicitly permits. |

Phone verification grants participation, not identity, business or property-authority badges. Expired provider verification does not remove ordinary seeker rights unless separately restricted.

## Organization permission matrix

Every cell still requires active membership, eligible account, organization scope and any assignment condition. Publication below means requesting a guarded publication operation after moderation, never setting a database state directly.

| Action | OWNER | ADMIN | LISTING_MANAGER | AGENT | ANALYST |
|---|---|---|---|---|---|
| Organization public/settings edit | Yes | Yes, non-ownership | No | No | No |
| Invite/revoke ordinary members | Yes | Yes, non-owner/non-admin | No | No | No |
| Appoint/remove OWNER or ADMIN | Yes, step-up | No | No | No | No |
| Transfer ownership / close org | Yes, step-up | No | No | No | No |
| Property/listing drafts | Org scope | Org scope | Org scope | Assigned resources; create assigned draft | No |
| Submit/request publication | Yes | Yes | Yes | No | No |
| Pause/archive organization listing | Yes | Yes | Yes | No | No |
| Assign listing/interaction | Yes | Yes | Yes | No | No |
| Handle messages/viewings | Org operational scope | Org operational scope | Assigned/delegated | Assigned | No |
| Provider-side review | For assigned/delegated interaction | Same | Same | Assigned | No |
| Aggregate business analytics | Yes | Yes | Inventory/operational scope | Assigned resource stats | Aggregate only |
| Submit business/authority evidence | Yes | Explicit delegated case | No | No | No |
| Read verification evidence | Own submitted case only | Explicit delegated case only | No | No | No |

Only an OWNER grants another OWNER or ADMIN role. An ADMIN cannot remove, suspend or demote an OWNER/ADMIN. Multiple owners are supported. Under a transaction lock, ordinary membership mutations cannot leave zero active owners. A dedicated transfer operation verifies the recipient, requires their acceptance and atomically preserves an active owner. Recovery of an inaccessible final owner requires a scoped staff case; it never silently assigns ownership from matching email domains.

Invitation expires after 7 days. Bind acceptance to the intended authenticated verified contact; store only a digest of the one-time invite token. Revoke pending invitations on organization closure. Membership and assignment removal immediately removes future resource access; historical actor attribution remains.

An agent may create a draft within the organization only through an operation that assigns it to that active membership. Agent role never grants arbitrary organization-wide search of private messages or evidence.

## Staff roles

| Role | Grants | Explicit exclusions |
|---|---|---|
| SUPER_ADMIN | Staff grants, controlled configuration, recovery and explicitly scoped exceptional actions | No implicit day-to-day reading of all private messages/evidence; access needs purpose and scope. |
| VERIFICATION_OFFICER | Assigned verification case/evidence read and decision | Cannot approve own provider, organization or property claim. No staff-role administration. |
| LISTING_MODERATOR | Assigned/region listing review, correction, approval, hide, duplicate property review | No general identity evidence or private message access. |
| TRUST_SAFETY_MODERATOR | Report triage, assigned case evidence, content sanctions, temporary capability restrictions, reviews and appeals | No staff-grant changes, no permanent account suspension without explicit high-severity grant. |
| SUPPORT_AGENT | User-provided support context, safe status lookup, recovery escalation | No secret/token viewing, evidence browsing, sanctions or arbitrary conversation access. |
| ANALYST | Approved aggregate metrics | No raw evidence, exact addresses, private conversations or enforcement actions. |

Platform staff use the separate staff application/client with MFA. Sensitive evidence access, verification decisions, owner recovery/transfer, permission grants, account suspension and destructive moderation require recent step-up (within 15 minutes), a reason and audit record. Routine staff session idle/absolute limits are in ADR 0002.

Temporary capability restrictions up to 7 days can be applied by TRUST_SAFETY_MODERATOR within an assigned case. Longer/permanent restrictions, full account suspension and staff permission changes require explicit elevated permission and step-up. Emergency hiding of suspected dangerous public content is allowed to assigned listing/safety staff, with immediate audit and case follow-up. An appeal cannot automatically lift an active safety hold.

## Publication predicate

Required: authenticated permitted actor; ACTIVE account and relevant principal; valid role/assignment; current provider identity for individual or business verification for organization; current declared or verified matching property relationship; no unresolved adverse authority outcome or risk hold; enabled region; valid asset; compatible Offering; approved processed media; moderation approval for current revision; nonexpired freshness; eligible market status; no applicable restriction.

There is no universal `P2 + A2` or `O2 + A2` condition. Old level labels are historical; implement the named verification claims. A recorded risk hold can specifically require VERIFIED PROPERTY_AUTHORITY. Provider or organization verification never proves authority by itself.

## Interactions, reviews and evidence

Viewings inherit interaction/listing/seeker/provider identifiers from the server. Org actors must be assigned or explicitly delegated. A review uses one eligibility per provider principal/direction, with `author_user_id` preserving the acting member. Blocked actors cannot create new contact; reporting, appeals and controlled cancellation remain possible. Staff participation through a separate personal capacity never grants staff-based review eligibility.

Evidence URLs require a fresh server check against the evidence case and access purpose. A listing agent cannot obtain them via media owner IDs. Applicants can access only their own submission workflow; internal notes, fraud signals and third-party data remain protected. URL access is short-lived and audited.

## Failure and audit behavior

Return stable reason categories: AUTH_REQUIRED, PHONE_REQUIRED, CAPABILITY_RESTRICTED, RESOURCE_SCOPE_DENIED, VERIFICATION_REQUIRED, AUTHORITY_REQUIRED, INVALID_STATE, STALE_VERSION, STEP_UP_REQUIRED and RATE_LIMITED. Public responses should use not-found where existence itself is sensitive. Do not reveal internal risk rules or private identifiers.

Record actor, principal, target, action, reason, request ID, policy version and timestamp for privilege changes, evidence access, ownership changes, verification/moderation decisions and security-relevant denials. Never record tokens, OTPs or raw identity documents.

## Required acceptance evidence

Tests must cover cross-user and cross-organization denial, unassigned agent denial, revoked membership/session denial, final-owner races, email-based takeover attempts, missing verification, risk-held authority, stale listing revision, duplicate org reviews, staff escalation limits and evidence URL authorization. A hidden UI button is not evidence of authorization.
