# Pachi — Verification Model

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Authority and model

Implements [product specification](../00-product/product-specification.md), [permissions](roles-and-permissions.md) and [lifecycle states](lifecycle-states.md). Verification proves a narrow claim about a named subject. It never overrides resource authorization or implies a safe transaction, legal title guarantee or current availability.

Use named claims and operational tiers. Do not implement a global `is_verified` flag or the older U/P/O/A numeric levels as competing permission systems.

| Claim | Subject | Meaning and minimum method |
|---|---|---|
| PHONE_OWNERSHIP | User/PhoneContact | Current control of normalized phone, verified by a one-use OTP challenge. Not identity. |
| IDENTITY | User | Optional seeker identity check using supported ID and live selfie or documented assisted comparison. |
| PROVIDER_IDENTITY | ProviderProfile | Provider's identity and declared provider capacity reviewed manually against their user/profile. |
| BUSINESS | Organization | Organization existence and applicant's authority to represent it reviewed against supported business and representative evidence. |
| PROPERTY_AUTHORITY | ProviderPropertyRelationship | Evidence supports the named provider's asserted relationship to that specific property within a validity period. Not conclusive legal title. |

| Tier | Minimum current claim | Capabilities |
|---|---|---|
| T0 Browse | None | Public discovery. |
| T1 Account | PHONE_OWNERSHIP and permitted user state | Save, contact, message, viewing requests, reports and eligible reviews. |
| T2 Provider | PROVIDER_IDENTITY and T1 | Individual provider submission/publication subject to relationship, listing and moderation checks. |
| T3 Organization | BUSINESS for organization plus T1 authorized member | Organization submission/publication subject to role, assignment, relationship and listing checks. |

These tiers describe capabilities, not a single ascending score: a verified business does not verify every member; a verified provider does not verify every property. Email verification from Cognito concerns sign-in/recovery, not a marketplace identity badge.

## Publication and authority policy

Every listing requires a matching, current ProviderPropertyRelationship. In ordinary MVP cases, a current declaration is sufficient. Authority verification is optional and grants a separate narrow badge. A documented risk hold requires verified authority before submission/publication when ownership is disputed, the claim was rejected/revoked, representation is inconsistent, or staff identifies concrete fraud evidence. Risk reasons are internal and reviewable; users receive actionable remediation without exposing detection logic.

A pending authority application does not erase an otherwise valid declaration. A rejected/revoked/expired relationship is not publishable; creating a new declaration cannot bypass its unresolved adverse case. Expiry of the optional verification badge alone may return a still-valid, nonadverse relationship to an unverified declaration projection, with the old decision preserved. This differs from expiry of the relationship's authorization period, which blocks publication.

## Evidence policy

| Subject/category | Accepted evidence class for manual workflow | Checks |
|---|---|---|
| Individual identity/provider | Government identity document plus live selfie; assisted identity comparison allowed only through recorded exception | Subject match, readable/unexpired document, tamper indicators, unique account linkage, manual reviewer decision; no unsupported automated biometric claim. |
| Organization | Business registration or supported official existence evidence; representative identity; authorization to act | Name/entity match, representative role, records and contact consistency; document legal basis must be validated for Cameroon before intake. |
| Owner/landlord authority | Property-specific ownership/control documentation or a documented lawful control basis | Subject/property match, scope and dates, contradictory claims. Badge wording does not promise title quality. |
| Independent agent | Mandate/authorization from principal identifying provider, property, permitted actions and duration | Principal relationship, validity, scope, revocation conditions. |
| Property manager | Management agreement/mandate identifying property and manager | Management powers, effective dates and principal. |
| Organization property authority | Same property evidence plus the organization as principal or authorized representative | A member's identity alone is insufficient. |

Local document variants and legal sufficiency must be validated before collecting real evidence (gate E01). The categories and workflow are settled; this document does not fabricate that validation. Unsupported/unreadable evidence goes to NEEDS_RESUBMISSION with a precise reason or REJECTED if an actual negative decision is justified. No automatic approval because an upload succeeded.

## Submission and decision workflow

1. Confirm applicant scope and subject; show purpose, access, retention and correction/appeal information.
2. Create case with evidence policy version. Issue private constrained upload authorization.
3. Validate/process evidence, retain original only under evidence policy, record hashes and chain of access. Never expose via listing media.
4. Submit immutable evidence snapshot; incomplete/failed assets cannot enter review.
5. Route to authorized queue/region and assigned VERIFICATION_OFFICER. Applicant cannot review own claim, organization or property.
6. Record VERIFIED, REJECTED or NEEDS_RESUBMISSION with reviewer, timestamp, reason code, policy version, evidence references and validity.
7. Apply claim projection, permissions/badges and dependent listing changes atomically or with immediate guard plus durable work.
8. Notify applicant safely; offer correction or appeal as applicable. New evidence/renewal creates a new case linked to prior decisions.

An operator may hold several roles but cannot impersonate a second independent reviewer. For a genuine personal conflict, leave the claim blocked until a nonconflicted authorized reviewer is available or exclude that provider/property from the pilot. Ordinary administrative appeals may be reconsidered by the same sole operator after fresh review with disclosed review mode; see interaction/moderation policy.

## Validity and rechecks

Initial engineering defaults: IDENTITY/PROVIDER_IDENTITY and BUSINESS claims expire after 12 months or supporting document expiry, whichever is earlier. PROPERTY_AUTHORITY expires at the mandate/evidence validity end or 12 months, whichever is earlier. Renew with a new case; send 30-day and 7-day reminders where applicable. These periods are configurable/versioned and must be checked during local evidence-policy validation.

Phone ownership is reconfirmed on number change, account recovery involving phone, or a specific risk event; no arbitrary annual identity claim follows from an OTP. Number reassignment and duplicate verified contacts require secure recovery, not release of the old account merely to the new OTP recipient.

On required claim expiry, listings are immediately ineligible for discovery and set PAUSED with system reason. On revocation/adverse authority, suppress immediately, set HIDDEN/ESCALATED and link a case. Reverification does not automatically restore publication. Already scheduled interactions retain safe read/cancel/dispute access; new publishing/contact permissions follow current restrictions.

## OTP controls

Normalize E.164; initially allow Cameroon destinations unless an explicit supported-market policy enables another country. Use a cryptographically random six-digit code, 5-minute TTL, keyed digest at rest, one-time consumption and purpose binding. Maximum 5 verification attempts per challenge, 60-second resend cooldown and 5 sends per phone/account per hour; combine IP/device/destination/spend limits. New challenge invalidates the prior challenge for that purpose. Do not log codes or include them in analytics.

Use neutral responses to reduce account enumeration. Challenge consumption and phone binding are atomic. Provider success is not proof of delivery; OTP redemption is not legal identity. Mock codes/destinations are permitted only in isolated local/test environments and must fail closed in production configuration.

## Badges and public language

Allowed labels: Phone confirmed; Identity checked; Provider identity checked; Business checked; Property authority evidence checked. Include applicable subject, current validity and an explanation of limitations. Expired/revoked claims lose their badge immediately. Do not display generic “fully verified”, “safe property”, “guaranteed owner” or government endorsement.

Public APIs return only approved claim summaries. No evidence IDs, storage keys, reviewer notes, document numbers or private legal identity fields. Applicant views expose their own decision reasons and permitted submission references without third-party evidence.

## Retention and access

Private evidence is classified separately, encrypted, excluded from public CDN, and accessible only through authorized short-lived URLs (maximum 60 seconds). Log grant/access intent with actor, case, purpose and request ID. Log actual storage access where supported without copying content into logs.

Every evidence object requires a retention policy, delete-after date and legal/safety hold state. Synthetic local defaults may use 30 days after case closure. **Real evidence collection is disabled until gate E01 records the approved retention schedule, privacy notice, deletion/backup treatment and supported document types.** No fictitious legal retention period is asserted here.

Deletion covers originals, derived copies, rejected/quarantine objects, abandoned uploads and object versions where permitted. An active hold prevents deletion and has a review date/owner. Retain minimized decision/audit metadata under its own schedule. Restores must replay deletion tombstones so expired evidence is not silently reintroduced.

## Appeals and acceptance evidence

Verification rejection/revocation supports a linked appeal within 30 days of decision notice. Record new evidence, reviewer/conflict mode and reason; outcomes UPHELD, OVERTURNED, PARTIALLY_UPHELD. No direct editing of the original decision or bypass of a still-active restriction.

Required tests: claim/subject separation, cross-case evidence denial, own-claim denial, OTP replay/brute-force/race controls, duplicate phone binding, expiry and revocation suppression, optional-badge expiry versus relationship expiry, risk-held publication, safe appeal restoration, retention holds and deletion tombstones. Synthetic tests do not pass the real-evidence operating gate.
