# Pachi — Roles and Permissions

> **Status:** Draft for Review  
> **Last Updated:** 2026-09-19  
> **Authority:** This document is the primary source of truth for application roles, authorization boundaries, and permission ownership.  
> **Related Documents:**  
> - `docs/00-product/product-specification.md`
> - `docs/01-domain/domain-model.md`
> - `docs/01-domain/verification-model.md`
> - `docs/01-domain/lifecycle-states.md`
> - `docs/04-business-rules/listing-rules.md`
> - `docs/04-business-rules/interaction-rules.md`
> - `docs/04-business-rules/review-rules.md`
> - `docs/04-business-rules/moderation-rules.md`

---

## 1. Purpose

This document defines who may perform which actions in Pachi.

It establishes the authorization model for:

- public visitors;
- registered users;
- property seekers;
- individual property providers;
- organization members;
- organization administrators;
- organization owners;
- moderators;
- platform administrators.

The backend must enforce these permissions.

Frontend or mobile visibility rules may improve user experience, but hiding an action in the interface is never sufficient authorization.

---

## 2. Authorization Principles

Pachi follows these authorization principles.

### 2.1 Default deny

An action is denied unless the authenticated actor has an explicit permission or satisfies an explicit authorization rule.

### 2.2 Least privilege

Users receive only the permissions required for their role and resource scope.

### 2.3 Resource ownership matters

Having permission to perform an action does not automatically grant permission over every resource of that type.

Examples:

- an individual provider may update their own property, but not another provider's property;
- an organization member may act only on resources belonging to organizations in which they have an active membership;
- a seeker may edit only their own profile and requests.

### 2.4 Verification and authorization are separate concepts

A role determines what type of action an actor may be eligible to perform.

Verification may determine whether that actor is currently allowed to exercise the permission.

Example:

- a provider role may allow listing publication in principle;
- the verification model may require a specific verification level before publication is permitted.

Verification requirements are defined in `verification-model.md`.

### 2.5 State transitions must also be valid

Authorization does not override entity lifecycle rules.

A user may have permission to update a listing but still be prevented from performing an invalid state transition.

Lifecycle rules are defined in `lifecycle-states.md`.

### 2.6 Privileged actions must be auditable

Sensitive actions performed by organization administrators, moderators, or platform administrators should produce an audit record where appropriate.

### 2.7 Server-side enforcement is authoritative

Permissions must be checked on the server for every protected operation.

Client applications must not be trusted to enforce security boundaries.

---

## 3. Role Model

Pachi should avoid treating every user category as a mutually exclusive global role.

A single account may have several capabilities depending on context.

For example, the same person may:

- search for housing as a seeker;
- provide a property as an individual provider;
- belong to a property-management organization.

The authorization model therefore combines:

1. **account state**;
2. **provider capability**;
3. **organization membership role**;
4. **platform staff role**;
5. **resource ownership or organization scope**;
6. **verification state**;
7. **entity lifecycle state**.

---

## 4. Actor Types

### 4.1 Guest

A guest is a visitor who has not authenticated.

Typical capabilities:

- browse publicly available listings;
- search and filter listings;
- view public property details;
- view public provider or organization information;
- begin account registration;
- begin login.

Guests must not access private account, interaction, verification, moderation, or administrative data.

---

### 4.2 Authenticated User

An authenticated user has a valid Pachi account and session.

Every normal account begins with the base permissions of an authenticated user.

Typical capabilities:

- manage their own account;
- manage their own profile;
- save or unsave listings;
- contact eligible providers;
- initiate supported marketplace interactions;
- report content or users;
- manage their own notifications and preferences;
- view their own interaction history.

An authenticated user may act as a seeker without requiring a separate exclusive account type.

---

### 4.3 Seeker

A seeker is an authenticated user acting in the property-discovery side of the marketplace.

The seeker capability includes actions such as:

- searching for housing;
- saving listings;
- contacting providers;
- requesting viewings where supported;
- participating in marketplace interactions;
- submitting eligible reviews;
- reporting suspicious listings or providers.

A user does not lose seeker capabilities merely because they also become a provider.

---

### 4.4 Individual Provider

An individual provider is a user who provides or manages property outside an organization context.

Subject to verification and business rules, an individual provider may:

- create and manage provider information;
- create and manage properties they are authorized to represent;
- create listing drafts;
- publish eligible listings;
- manage listing availability;
- respond to seeker inquiries;
- manage supported viewing or interaction workflows;
- receive eligible reviews;
- report abusive users or content.

An individual provider must not manage another provider's resources unless ownership or management authority has been explicitly transferred through a supported workflow.

---

### 4.5 Organization Member

An organization member is a user with an active membership in an organization.

Organization permissions apply only within the organization to which the membership belongs.

A membership must have a defined organization role.

The initial organization roles are:

- **Organization Owner**
- **Organization Admin**
- **Organization Agent**

Additional organization roles should not be introduced without updating this document.

---

### 4.6 Organization Agent

An organization agent performs normal operational work for an organization.

Subject to organization scope, verification, and business rules, an organization agent may typically:

- view organization properties;
- create property or listing drafts;
- update organization properties and listings they are authorized to manage;
- respond to seeker inquiries;
- participate in viewing and interaction workflows;
- view operational information required for assigned work.

An organization agent must not:

- change organization ownership;
- change organization-wide security settings;
- grant administrator privileges;
- remove the organization owner;
- perform platform moderation;
- access unrelated organizations.

Whether agents may directly publish listings or require organization-admin approval is an open product decision identified later in this document.

---

### 4.7 Organization Admin

An organization admin manages the organization and its marketplace operations.

In addition to agent permissions, an organization admin may typically:

- manage organization profile information;
- invite organization members;
- remove eligible organization members;
- change eligible member roles;
- manage organization properties;
- manage organization listings;
- manage organization-level operational settings;
- review organization verification status;
- manage organization interactions.

Organization admins must not:

- remove or demote the organization owner;
- transfer organization ownership unless explicitly authorized by the ownership-transfer workflow;
- perform platform-wide moderation;
- access unrelated organizations.

---

### 4.8 Organization Owner

The organization owner is the highest-privileged membership role within one organization.

The owner receives organization-admin permissions and additionally controls ownership-level actions.

Subject to supported workflows, the organization owner may:

- manage organization administrators;
- approve ownership-sensitive changes;
- transfer organization ownership;
- initiate organization closure or deactivation;
- control organization-level settings reserved for ownership.

Every active organization should have exactly one active owner unless the domain model explicitly defines a temporary transitional state.

The owner is still not a platform administrator.

---

### 4.9 Moderator

A moderator is a platform staff role responsible for marketplace safety and policy enforcement.

Subject to moderation rules, a moderator may:

- access the moderation queue;
- review reports;
- inspect reported listings and public marketplace activity;
- hide or restrict content;
- apply supported moderation actions;
- record moderation decisions;
- review relevant evidence;
- escalate cases to platform administrators.

Moderators should not automatically receive unrestricted access to:

- production infrastructure;
- platform configuration;
- secrets;
- financial systems;
- organization ownership controls;
- unrelated private user data.

Moderation actions must follow `moderation-rules.md`.

---

### 4.10 Platform Administrator

A platform administrator is a highly privileged platform staff role.

Platform administrators may perform operational actions required to manage the platform, including:

- manage privileged platform staff where permitted;
- resolve escalated moderation cases;
- manage platform-level operational configuration;
- perform authorized account interventions;
- manage supported platform controls;
- inspect audit records;
- resolve exceptional organization or verification cases.

Platform-administrator permissions must be narrowly implemented and audited.

Platform administrator status must never be inferred from frontend state or ordinary account data.

---

## 5. Platform Role Hierarchy

The following represents privilege scope, not inheritance of every business action:

```text
Guest
  ↓
Authenticated User / Seeker
  ↓
Provider Capability

Organization scope:
Organization Agent
  ↓
Organization Admin
  ↓
Organization Owner

Platform staff scope:
Moderator
  ↓
Platform Administrator
```

The organization hierarchy and platform staff hierarchy are separate.

An organization owner does not gain moderator permissions.

A moderator does not automatically gain organization-owner permissions.

---

## 6. Permission Matrix

Legend:

- **Yes** — generally permitted, subject to resource ownership and valid lifecycle state.
- **Scoped** — permitted only within the actor's owned or organization-scoped resources.
- **Eligible** — permission requires additional eligibility such as verification or completed interaction.
- **No** — not permitted through this role.
- **Policy** — controlled by a separate authoritative rule set.

| Action | Guest | User / Seeker | Individual Provider | Org Agent | Org Admin | Org Owner | Moderator | Platform Admin |
|---|---|---|---|---|---|---|---|---|
| Browse published listings | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Search and filter listings | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| View public provider profiles | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Manage own account | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Save listings | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Contact a provider | No | Eligible | Eligible | Eligible | Eligible | Eligible | Policy | Policy |
| Request a viewing | No | Eligible | Eligible | Eligible | Eligible | Eligible | Policy | Policy |
| Report listing/user/content | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Submit a review | No | Eligible | Eligible | Eligible | Eligible | Eligible | Policy | Policy |
| Create provider profile | No | Eligible | Eligible | Eligible | Eligible | Eligible | No | No |
| Create individual property | No | No | Eligible | No | No | No | No | Policy |
| Edit own individual property | No | No | Scoped | No | No | No | No | Policy |
| Create individual listing draft | No | No | Scoped | No | No | No | No | Policy |
| Publish individual listing | No | No | Eligible | No | No | No | Policy | Policy |
| Create organization property | No | No | No | Scoped | Scoped | Scoped | No | Policy |
| Edit organization property | No | No | No | Scoped | Scoped | Scoped | No | Policy |
| Create organization listing draft | No | No | No | Scoped | Scoped | Scoped | No | Policy |
| Publish organization listing | No | No | No | Open | Eligible | Eligible | Policy | Policy |
| Respond to seeker inquiry | No | No | Scoped | Scoped | Scoped | Scoped | Policy | Policy |
| Manage organization profile | No | No | No | No | Scoped | Scoped | No | Policy |
| Invite organization members | No | No | No | No | Scoped | Scoped | No | Policy |
| Remove organization members | No | No | No | No | Scoped | Scoped | No | Policy |
| Change member roles | No | No | No | No | Scoped | Scoped | No | Policy |
| Assign organization admin | No | No | No | No | Scoped* | Scoped | No | Policy |
| Transfer organization ownership | No | No | No | No | No | Scoped | No | Policy |
| Close/deactivate organization | No | No | No | No | No | Scoped | No | Policy |
| Review reports | No | No | No | No | No | No | Yes | Yes |
| Moderate listings/content | No | No | No | No | No | No | Policy | Policy |
| Apply account restrictions | No | No | No | No | No | No | Policy | Policy |
| Manage platform staff | No | No | No | No | No | No | No | Policy |
| Access platform audit logs | No | No | No | No | No | No | Scoped | Yes |

\* An organization admin may assign administrator status only if the final organization-governance rules permit it. An admin must never be able to remove, demote, or replace the organization owner.

---

## 7. Permission Categories

The implementation should group permissions by domain rather than relying only on broad role names.

Example categories:

```text
account.*
profile.*
property.*
listing.*
organization.*
membership.*
interaction.*
review.*
verification.*
report.*
moderation.*
admin.*
audit.*
```

Possible permission identifiers include:

```text
account.read.self
account.update.self

property.create.individual
property.read.own
property.update.own
property.create.organization
property.update.organization

listing.create
listing.update.own
listing.publish.own
listing.archive.own

organization.read
organization.update
organization.close

membership.invite
membership.remove
membership.role.update

interaction.create
interaction.read.own
interaction.update.own

review.create
review.update.own

report.create
report.read.assigned

moderation.content.restrict
moderation.account.restrict

audit.read
```

These identifiers are examples for architectural consistency.

The final implementation may use a different naming convention, but the resulting authorization behavior must remain consistent with this document.

---

## 8. Resource Scope Rules

### 8.1 User-owned resources

A normal user may access private user-owned resources only when:

```text
resource.user_id == authenticated_user.id
```

unless a documented staff permission explicitly permits otherwise.

---

### 8.2 Individual-provider resources

An individual provider may modify a provider-owned resource only when the provider is the authorized controller of that resource.

The implementation should not rely solely on client-supplied provider IDs.

---

### 8.3 Organization resources

Organization permissions require:

1. an active organization membership;
2. the required membership role;
3. the resource to belong to the same organization;
4. any required verification state;
5. a valid resource lifecycle state.

Conceptually:

```text
membership.user_id == authenticated_user.id
AND membership.organization_id == resource.organization_id
AND membership.status == ACTIVE
AND membership.role permits requested_action
```

---

### 8.4 Platform-staff access

Platform staff access should be granted through a dedicated staff authorization mechanism.

Platform privileges should not be represented merely by editable user-profile fields.

---

## 9. Organization Membership Rules

### 9.1 Membership must be explicit

A user's relationship with an organization must be represented by an organization-membership record.

Do not infer membership from:

- email domain;
- listing authorship;
- provider name;
- organization contact details.

### 9.2 Membership states

Membership lifecycle states should be defined in `lifecycle-states.md`.

Expected concepts may include:

```text
INVITED
ACTIVE
SUSPENDED
REMOVED
```

The lifecycle document is authoritative for final state names and transitions.

### 9.3 Membership removal

When a membership becomes inactive, organization-scoped permissions must stop immediately.

Historical records should continue to preserve the actor responsible for previous actions.

### 9.4 Organization owner protection

The organization owner must not be removed through the ordinary member-removal flow.

Ownership must first be transferred through a dedicated ownership-transfer workflow.

---

## 10. Provider Authorization

Provider capability should not be implemented as unrestricted CRUD access.

Provider actions may depend on:

- account status;
- provider status;
- verification level;
- property ownership or management authority;
- listing status;
- organization membership;
- moderation restrictions.

Example:

```text
can_publish_listing =
    authenticated
    AND account_is_active
    AND provider_is_eligible
    AND actor_controls_property
    AND listing_state_allows_publication
    AND required_verification_is_satisfied
    AND no_applicable_moderation_restriction
```

The exact verification rules belong in `verification-model.md`.

---

## 11. Review Authorization

Review creation must not be based merely on role.

A user must satisfy review eligibility rules.

Expected checks may include:

- authenticated user;
- qualifying marketplace interaction;
- correct review target;
- interaction state permits review;
- review window is still open, if such a window exists;
- user has not already submitted a prohibited duplicate review;
- account is not restricted from reviewing.

The final rules belong in:

- `review-system.md`;
- `review-rules.md`;
- `interaction-rules.md`.

---

## 12. Moderation Authorization

Moderation permissions must be separate from ordinary marketplace roles.

A provider, organization owner, or seeker must never gain moderation authority merely because of marketplace status.

Moderation actions should distinguish between actions such as:

- dismiss report;
- request additional review;
- hide listing;
- remove content;
- restrict listing publication;
- restrict account actions;
- suspend account;
- escalate case.

The exact authority for each moderation action belongs in `moderation-rules.md`.

---

## 13. Administrative Safety Requirements

Sensitive actions should require stronger controls.

Examples include:

- changing platform staff roles;
- transferring organization ownership;
- suspending an account;
- revoking verification;
- permanently removing content;
- accessing sensitive verification evidence;
- viewing security or audit information.

Depending on the final architecture, controls may include:

- re-authentication;
- multi-factor authentication;
- audit logging;
- reason codes;
- approval workflow;
- restricted admin endpoints.

These controls should be finalized in the security and authorization engineering documents.

---

## 14. Authorization Failure Behavior

Authorization failures should not reveal unnecessary private information.

Examples:

- a user requesting another user's private resource should receive an appropriate authorization or not-found response;
- the system should avoid confirming the existence of sensitive records when the actor is not authorized to know they exist.

API behavior will be defined in `api-specification.md`.

---

## 15. Account Restrictions

Account restrictions may remove individual capabilities without changing the user's underlying identity.

Examples may include:

```text
CAN_CONTACT_PROVIDERS = false
CAN_CREATE_LISTINGS = false
CAN_PUBLISH_LISTINGS = false
CAN_SUBMIT_REVIEWS = false
```

The moderation model should determine whether Pachi uses capability restrictions, account states, or a combination of both.

The implementation should avoid overloading a single `is_banned` boolean for all enforcement behavior.

---

## 16. Permission Checks Required in Tests

Authorization behavior must be tested independently from UI behavior.

At minimum, automated tests should cover:

### Account scope

- user can read own private account data;
- user cannot read another user's private account data;
- user can update own supported profile fields;
- user cannot update another user's profile.

### Individual providers

- eligible provider can create authorized property resources;
- provider cannot update another provider's property;
- provider cannot publish when required verification is missing;
- provider cannot perform invalid listing state transitions.

### Organizations

- agent can access permitted resources in own organization;
- agent cannot access another organization's private resources;
- inactive membership has no organization permissions;
- admin can perform supported membership-management actions;
- admin cannot remove or demote organization owner;
- owner can perform ownership-level actions;
- ordinary member cannot perform admin actions.

### Reviews

- eligible participant can review according to review rules;
- unrelated user cannot create a review;
- duplicate review behavior follows review rules.

### Moderation

- ordinary users cannot access moderation endpoints;
- moderator can perform authorized moderation actions;
- moderator cannot perform platform-admin-only actions;
- privileged actions create required audit records.

---

## 17. Implementation Guidance

The authorization system should evaluate:

```text
Who is the actor?
What role or capability do they have?
What resource are they acting on?
Do they control or belong to the resource scope?
Does verification permit the action?
Does the entity's current state permit the action?
Does a moderation restriction block the action?
Is a stronger privileged control required?
```

The application should not rely on checks such as:

```text
if user.role == "provider"
```

when the real rule depends on ownership, organization scope, verification, lifecycle state, or moderation restrictions.

---

## 18. Open Decisions

The following decisions should be resolved before implementation of the affected feature.

### OD-001 — Organization agent publication rights

Should an organization agent be able to publish a listing directly, or only create/edit a draft that an organization admin or owner publishes?

**Current status:** Open.

---

### OD-002 — Organization admin appointment

May an organization admin promote another active member to organization admin, or is this reserved for the organization owner?

**Current status:** Open.

---

### OD-003 — Contact eligibility

What minimum account or verification requirements must be satisfied before a user may contact a provider?

**Current status:** To be resolved by product and verification rules.

---

### OD-004 — Listing publication verification

What verification level is required before:

- an individual provider may publish;
- an organization may publish;
- an organization agent may act on behalf of the organization?

**Current status:** To be resolved in `verification-model.md`.

---

### OD-005 — Moderator account restrictions

Which restrictions may a moderator apply directly, and which require platform-administrator approval?

**Current status:** To be resolved in `moderation-rules.md`.

---

### OD-006 — Multiple organization memberships

May one user belong to multiple provider organizations simultaneously?

**Current status:** Open.

The recommended domain model should support this unless the product specification explicitly forbids it.

---

### OD-007 — Provider acting as seeker

Can an individual provider use the same account to search for property and participate as a seeker?

**Current proposal:** Yes.

Roles should represent capabilities rather than mutually exclusive account types.

---

## 19. Decisions Established by This Document

Unless changed through an approved product update, this document establishes the following baseline decisions:

1. A normal account may act as a seeker without requiring a separate seeker account type.
2. Provider capability is not mutually exclusive with seeker capability.
3. Organization permissions are membership-scoped.
4. Initial organization roles are Owner, Admin, and Agent.
5. Organization roles do not grant platform staff privileges.
6. Moderation privileges are separate from marketplace roles.
7. Authorization must be enforced server-side.
8. Verification, lifecycle state, resource ownership, and moderation restrictions may further constrain a role's permissions.
9. The organization owner cannot be removed through the ordinary membership-removal flow.
10. Privileged platform actions should be auditable.

---

## 20. Definition of Done

This document can move from **Draft for Review** to **Approved** when:

- the organization-role model is accepted;
- publication rights for organization agents are resolved;
- administrator appointment rules are resolved;
- multiple-organization membership behavior is confirmed;
- verification-dependent permissions are aligned with `verification-model.md`;
- moderation authority is aligned with `moderation-rules.md`;
- no known conflicts remain with the product specification or core domain model.
