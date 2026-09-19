# Pachi Cameroon Housing Marketplace — Documentation

This directory contains the official product, domain, engineering, business-rule, delivery, and operational documentation for the Cameroon Housing Marketplace.

The documentation in this directory is part of the product itself.

The marketplace is being designed and developed by a single founder/developer working with AI. Because multiple AI sessions, development tools, and future contributors may interact with the project, these documents provide the persistent source of truth for how the system is intended to work.

Code should implement the documented system.

AI-generated implementation decisions must not silently replace documented product or business decisions.

---

# 1. Purpose of This Documentation

The `/docs` directory exists to:

* define what the product must do;
* define how core marketplace concepts behave;
* document business rules;
* establish technical architecture;
* define permissions and trust boundaries;
* document important engineering decisions;
* guide AI-assisted development;
* reduce contradictory implementations;
* preserve decisions across development sessions;
* provide context for testing and debugging;
* provide a historical record of architectural decisions;
* support future developers, designers, operators, or investors;
* prevent product requirements from existing only inside ChatGPT conversations.

Chat conversations may help create or discuss specifications, but they are **not the permanent source of truth**.

Once a decision has been approved and incorporated into this repository, the repository version takes precedence.

---

# 2. Documentation Principles

The project follows several documentation principles.

## 2.1 Repository documentation is canonical

Approved information should eventually be transferred from chats, notes, or temporary documents into this repository.

The latest committed version of an authoritative document is considered the official project specification.

---

## 2.2 Product rules must not live only in code

Important rules such as:

* who can create listings;
* who can review whom;
* when reviews become available;
* what verification levels mean;
* how provider organizations work;
* who can manage properties;
* when interactions enter particular states;
* what moderation actions are permitted;

must be documented independently of their implementation.

The code implements the rule.

The documentation defines the rule.

---

## 2.3 Product requirements and implementation decisions are separate

Product documents primarily answer:

> **What must the system do?**

Engineering documents primarily answer:

> **How will the system do it?**

For example:

Product requirement:

> A seeker may review a provider only after a qualifying interaction.

Engineering implementation:

> Review eligibility is enforced through an interaction eligibility record and validated by the review service.

The first belongs in the product/domain/business-rule documentation.

The second belongs in engineering documentation.

---

## 2.4 One concept should have one primary authority

Avoid defining the same rule independently in several documents.

Other documents may summarize or reference the rule, but one document should be considered authoritative.

For example:

`roles-and-permissions.md`

should be the authority for permission rules.

Other documents should reference it instead of maintaining separate permission matrices.

---

## 2.5 Documentation should describe actual intended behavior

Documentation should not contain speculative features as though they already exist.

Use explicit labels such as:

* `Approved`
* `Proposed`
* `Planned`
* `Deferred`
* `Deprecated`

where necessary.

---

# 3. Documentation Structure

```text
docs/
│
├── README.md
│
├── 00-product/
│   ├── product-vision.md
│   ├── product-specification.md
│   ├── mvp-scope.md
│   └── glossary.md
│
├── 01-domain/
│   ├── domain-model.md
│   ├── roles-and-permissions.md
│   ├── verification-model.md
│   ├── review-system.md
│   └── lifecycle-states.md
│
├── 02-ux/
│   ├── information-architecture.md
│   ├── user-flows.md
│   ├── screen-requirements.md
│   └── onboarding-flows.md
│
├── 03-engineering/
│   ├── system-architecture.md
│   ├── database-schema.md
│   ├── api-specification.md
│   ├── authentication.md
│   ├── authorization.md
│   ├── security.md
│   └── file-storage.md
│
├── 04-business-rules/
│   ├── listing-rules.md
│   ├── interaction-rules.md
│   ├── review-rules.md
│   ├── moderation-rules.md
│   └── fraud-prevention.md
│
├── 05-delivery/
│   ├── development-roadmap.md
│   ├── backlog.md
│   ├── release-gates.md
│   ├── testing-strategy.md
│   └── launch-checklist.md
│
├── 06-operations/
│   ├── analytics-plan.md
│   ├── moderation-operations.md
│   ├── support-process.md
│   └── deployment-runbook.md
│
└── decisions/
    ├── README.md
    ├── ADR-001-*.md
    ├── ADR-002-*.md
    └── ...
```

Additional folders may be introduced later where justified.

Do not create new folders simply because a document does not immediately seem to fit somewhere. Prefer the existing structure unless a genuinely new documentation domain emerges.

---

# 4. Authoritative Documentation

Some documents have a stronger role than others.

When documents appear to conflict, use the authority rules below.

## 4.1 Product Specification

**File**

```text
00-product/product-specification.md
```

**Status**

Authoritative.

This is the primary product specification.

It defines major product capabilities including:

* user types;
* providers;
* property seekers;
* organizations;
* properties;
* listings;
* offerings;
* verification;
* viewing and marketplace interactions;
* reviews;
* moderation;
* MVP boundaries;
* analytics expectations;
* release requirements.

Product functionality should not contradict this document unless the specification itself is updated.

---

## 4.2 Core Domain Model

**File**

```text
01-domain/domain-model.md
```

**Status**

Authoritative.

This defines the conceptual structure of the marketplace.

It is the primary authority for:

* entities;
* relationships;
* ownership;
* entity responsibilities;
* key fields;
* lifecycle concepts;
* domain boundaries.

Examples include:

* User
* Provider
* Organization
* Organization Membership
* Property
* Listing
* Offering
* Interaction
* Review
* Verification
* Report
* Audit Log

The physical database schema should implement this domain model but does not replace it.

---

## 4.3 Roles and Permissions

**File**

```text
01-domain/roles-and-permissions.md
```

**Status**

Authoritative once approved.

This document defines who is allowed to perform specific actions.

Examples include:

* seeker permissions;
* individual provider permissions;
* organization member permissions;
* organization administrator permissions;
* moderator permissions;
* platform administrator permissions.

The backend authorization system must implement these rules.

Frontend visibility alone must never be considered sufficient enforcement.

---

## 4.4 Verification Model

**File**

```text
01-domain/verification-model.md
```

**Status**

Authoritative once approved.

This document defines:

* verification levels;
* verification subjects;
* required evidence;
* verification states;
* expiration;
* rejection;
* revocation;
* re-verification;
* verification visibility;
* trust implications.

Verification must not be treated as one simple boolean unless the specification explicitly defines it that way.

---

## 4.5 Lifecycle States

**File**

```text
01-domain/lifecycle-states.md
```

**Status**

Authoritative once approved.

This document defines legal state transitions for entities such as:

* listings;
* offerings;
* interactions;
* reviews;
* verification requests;
* reports;
* organizations;
* memberships.

Backend code must reject invalid lifecycle transitions.

---

## 4.6 Database Schema

**File**

```text
03-engineering/database-schema.md
```

**Status**

Authoritative for the intended persistent data model once approved.

The domain model defines the business concepts.

The database schema defines how those concepts are persisted.

If the physical schema requires a technical deviation from the domain model, that deviation must be documented.

---

## 4.7 API Specification

**File**

```text
03-engineering/api-specification.md
```

**Status**

Authoritative for application interfaces once approved.

It defines:

* endpoints;
* operations;
* request structures;
* response structures;
* authentication requirements;
* authorization requirements;
* validation rules;
* error formats;
* pagination;
* filtering;
* API versioning.

Frontend or mobile clients should not depend on undocumented API behavior.

---

## 4.8 Business Rule Documents

Files inside:

```text
04-business-rules/
```

are authoritative for their respective areas once approved.

These files should contain detailed rules that would make the Product Specification unnecessarily large.

---

# 5. Authority Hierarchy

When two documents appear to conflict, do not silently choose whichever rule is easier to implement.

Resolve the conflict.

As a general hierarchy:

```text
Approved Product Decision
        ↓
Product Specification
        ↓
Domain Model
        ↓
Specialized Domain / Business Rule
        ↓
Architecture / Engineering Specification
        ↓
Database / API Implementation Detail
        ↓
Application Code
```

However, the hierarchy is primarily a conflict-resolution aid.

A lower-level document may intentionally refine a higher-level rule without contradicting it.

For example:

Product specification:

> Providers can publish property listings.

Listing rules:

> Individual providers may publish listings only after reaching the required verification level.

These statements are compatible.

---

# 6. Folder Responsibilities

## `00-product/`

Contains product-level definitions.

These documents answer:

* What are we building?
* Who are we building it for?
* What problems are we solving?
* What features exist?
* What belongs in the MVP?
* What is explicitly outside the MVP?

### `product-vision.md`

Defines:

* product purpose;
* target market;
* core problems;
* product principles;
* long-term direction.

This document should remain relatively stable.

### `product-specification.md`

The main product specification.

This should contain the approved high-level behavior of the marketplace.

### `mvp-scope.md`

Defines exactly what must and must not be included in the initial launch.

Every feature should fall into one of several categories:

* MVP;
* post-MVP;
* deferred;
* rejected.

This prevents uncontrolled scope expansion during implementation.

### `glossary.md`

Defines project terminology.

Examples:

* provider;
* seeker;
* property;
* listing;
* offering;
* interaction;
* viewing;
* organization;
* verification;
* review eligibility.

Developers and AI systems should use these terms consistently.

---

# 7. `01-domain/`

Contains the business/domain model independent of specific technologies.

## `domain-model.md`

Defines entities, relationships, responsibilities, and core domain constraints.

## `roles-and-permissions.md`

Defines access rights and permission boundaries.

## `verification-model.md`

Defines the marketplace trust and verification framework.

## `review-system.md`

Defines:

* review eligibility;
* review subjects;
* review authors;
* ratings;
* text reviews;
* review timing;
* review visibility;
* editing;
* disputes;
* moderation;
* abuse prevention.

The review system is part of the platform's accountability model and must therefore be defined carefully.

## `lifecycle-states.md`

Defines entity state machines and permitted transitions.

Where useful, state transitions should be represented using tables or diagrams.

---

# 8. `02-ux/`

Contains user experience requirements.

The UX documentation should implement the product rules rather than invent new product rules.

## `information-architecture.md`

Defines the structure of the application, including:

* main navigation;
* account areas;
* provider areas;
* organization areas;
* admin areas;
* major page relationships.

## `user-flows.md`

Documents important workflows such as:

* account registration;
* seeker onboarding;
* provider onboarding;
* organization creation;
* verification;
* property creation;
* listing creation;
* property discovery;
* contact initiation;
* viewing scheduling;
* interaction completion;
* review submission;
* reporting suspicious content.

## `screen-requirements.md`

Defines what individual application screens need to contain.

This may later serve as input for UI design or AI-assisted frontend implementation.

## `onboarding-flows.md`

Documents onboarding differences between:

* seekers;
* individual property providers;
* organization owners;
* organization staff.

---

# 9. `03-engineering/`

Contains technical implementation specifications.

## `system-architecture.md`

Defines the overall architecture.

It should cover:

* application components;
* frontend;
* backend;
* database;
* storage;
* caching;
* search;
* authentication;
* infrastructure;
* external services;
* deployment boundaries.

## `database-schema.md`

Defines:

* tables;
* columns;
* keys;
* indexes;
* relationships;
* constraints;
* enums;
* timestamps;
* deletion behavior.

The schema must remain traceable back to the domain model.

## `api-specification.md`

Defines the application API contract.

## `authentication.md`

Defines how identities are established.

Topics may include:

* registration;
* login;
* sessions;
* tokens;
* password recovery;
* email verification;
* phone verification;
* MFA if implemented;
* account recovery.

## `authorization.md`

Defines how permissions from the domain model are enforced technically.

Authentication answers:

> Who are you?

Authorization answers:

> Are you allowed to do this?

These should not be confused.

## `security.md`

Defines the project's security model, including:

* threat assumptions;
* sensitive data;
* authorization enforcement;
* rate limiting;
* abuse protection;
* input validation;
* audit logging;
* secrets handling;
* account security;
* infrastructure protections.

## `file-storage.md`

Defines handling of:

* property images;
* provider documents;
* verification documents;
* avatars;
* organization media;
* potentially sensitive uploads.

It should also define access-control requirements for private files.

---

# 10. `04-business-rules/`

Contains detailed marketplace rules.

These documents are particularly important because business rules often become difficult to infer correctly from code.

## `listing-rules.md`

Defines:

* who can create a listing;
* required fields;
* publication eligibility;
* listing statuses;
* duplicate listings;
* availability;
* expiration;
* suspension;
* archiving;
* reactivation.

## `interaction-rules.md`

Defines interactions between providers and seekers.

Examples:

* inquiry;
* contact request;
* viewing request;
* viewing scheduling;
* viewing completion;
* cancellation;
* no-show;
* deal progression where supported.

## `review-rules.md`

Defines enforceable rules surrounding reputation and reviews.

This document may reference `01-domain/review-system.md`.

The domain file describes the conceptual review system.

This file should emphasize enforceable business rules and edge cases.

## `moderation-rules.md`

Defines:

* what can be reported;
* report categories;
* moderation states;
* content removal;
* account restrictions;
* appeals;
* administrator actions.

## `fraud-prevention.md`

Documents known abuse patterns and defenses.

Examples may include:

* fake properties;
* duplicate properties;
* impersonation;
* fraudulent providers;
* misleading images;
* review manipulation;
* spam inquiries;
* organization impersonation.

This file should evolve as real marketplace abuse patterns are discovered.

---

# 11. `05-delivery/`

Contains documents used to turn the specifications into working software.

## `development-roadmap.md`

Defines the development sequence.

The roadmap should focus on dependencies rather than arbitrary dates.

Example:

```text
Foundation
→ Authentication
→ User Profiles
→ Provider System
→ Organizations
→ Properties
→ Listings
→ Search
→ Interactions
→ Reviews
→ Verification
→ Moderation
→ Analytics
→ Launch Hardening
```

Actual sequencing may differ once architecture work is completed.

## `backlog.md`

Contains implementation work that has not yet been completed.

Every major backlog item should ideally reference the relevant specification.

## `release-gates.md`

Defines what must be true before a release is considered acceptable.

Examples:

* critical user flows pass;
* authorization tests pass;
* no known critical security issue;
* backups verified;
* monitoring active;
* moderation capabilities available.

## `testing-strategy.md`

Defines the testing approach.

Potential categories include:

* unit tests;
* integration tests;
* API tests;
* authorization tests;
* state-machine tests;
* end-to-end tests;
* security tests;
* manual acceptance tests.

## `launch-checklist.md`

Contains the final operational checklist required before production launch.

---

# 12. `06-operations/`

Contains documentation for operating the marketplace after deployment.

## `analytics-plan.md`

Defines:

* events;
* funnels;
* metrics;
* marketplace health indicators;
* provider metrics;
* seeker metrics;
* trust metrics;
* conversion metrics.

## `moderation-operations.md`

Describes how actual moderation work is performed.

This is different from `moderation-rules.md`.

`moderation-rules.md` defines the rules.

`moderation-operations.md` defines the operational process used to enforce them.

## `support-process.md`

Defines how user support requests and disputes should be handled.

## `deployment-runbook.md`

Contains practical instructions for:

* deploying;
* rolling back;
* applying migrations;
* restoring services;
* managing incidents;
* checking application health.

---

# 13. Architecture Decision Records

The `decisions/` directory contains Architecture Decision Records, or ADRs.

ADRs document significant technical decisions.

Example filenames:

```text
ADR-001-application-architecture.md
ADR-002-primary-database.md
ADR-003-authentication-strategy.md
ADR-004-object-storage.md
ADR-005-search-architecture.md
```

Each ADR should describe:

```text
Title
Status
Date
Context
Decision
Alternatives Considered
Consequences
Related Documentation
```

Possible statuses include:

```text
Proposed
Accepted
Superseded
Deprecated
Rejected
```

An accepted ADR should not normally be rewritten to hide historical decisions.

If a major architectural decision changes, create another ADR and mark the previous ADR as superseded.

Example:

```text
ADR-003-authentication-strategy.md

Status: Superseded by ADR-011
```

This preserves architectural history.

---

# 14. Rules for Updating Documentation

Documentation should evolve with the system.

## Rule 1 — Update the authoritative document

When a decision changes, modify the file that owns that decision.

Do not simply add the new rule to whichever document is currently being edited.

---

## Rule 2 — Avoid duplicate authorities

Do not maintain two separate versions of the same rule.

Instead of duplicating content:

```text
See: ../01-domain/roles-and-permissions.md
```

Reference the authoritative file.

---

## Rule 3 — Update documentation before or with code

For meaningful behavioral changes, documentation should normally be updated:

1. before implementation; or
2. in the same change as implementation.

Avoid changing product behavior while leaving the specification outdated.

---

## Rule 4 — Do not silently change approved product behavior

If implementation reveals that an approved requirement is difficult or undesirable, do not simply change the code.

First determine whether the requirement should change.

Then update the relevant documentation.

Then implement the new approved behavior.

---

## Rule 5 — Preserve Git history instead of file versions

Do not create:

```text
product-spec-v2.md
product-spec-final.md
product-spec-final-new.md
product-spec-final-final.md
```

Use:

```text
product-specification.md
```

Git already provides version history.

---

## Rule 6 — Significant architecture changes require ADRs

Create an ADR when a decision:

* affects multiple parts of the system;
* would be expensive to reverse;
* introduces important infrastructure;
* changes security boundaries;
* establishes a major technical convention.

Minor implementation choices do not require ADRs.

---

## Rule 7 — Update dependent documents when necessary

A change may affect multiple specifications.

For example, changing review eligibility may require updating:

```text
01-domain/review-system.md
04-business-rules/review-rules.md
01-domain/lifecycle-states.md
03-engineering/api-specification.md
05-delivery/testing-strategy.md
```

Do not assume that updating one document automatically makes the others correct.

---

## Rule 8 — Use precise language

Prefer:

> A completed viewing makes both participating parties eligible to submit one review of the other party.

Avoid vague wording such as:

> Users can review each other after interacting.

Specifications should be testable whenever possible.

---

## Rule 9 — Record unresolved questions explicitly

Do not fill uncertainty with assumptions.

Use sections such as:

```text
## Open Questions
```

or markers such as:

```text
TODO
OPEN
PROPOSED
```

Unresolved product questions should eventually be resolved or deliberately deferred.

---

## Rule 10 — Remove obsolete requirements carefully

When a requirement is intentionally abandoned, remove it from the current specification.

If the reason for the decision matters historically, document it in an ADR or Git commit.

Current specifications should describe the current intended system rather than accumulating obsolete requirements indefinitely.

---

# 15. Documentation Status

Documents may optionally contain a metadata header.

Recommended format:

```markdown
> Status: Approved
> Last Updated: YYYY-MM-DD
> Owner: Project
```

Possible status values:

```text
Draft
Under Review
Approved
Implemented
Deprecated
```

`Approved` means the specification represents an accepted product or engineering decision.

`Implemented` may be used where useful to indicate that the corresponding system behavior has been built and validated.

A document does not need to be marked `Implemented` to remain authoritative.

---

# 16. Using Documentation With AI

AI tools should not be asked to make substantial implementation decisions without relevant project context.

For example, instead of:

```text
Build the property listing feature.
```

prefer:

```text
Read:

docs/00-product/product-specification.md
docs/01-domain/domain-model.md
docs/01-domain/roles-and-permissions.md
docs/01-domain/lifecycle-states.md
docs/04-business-rules/listing-rules.md
docs/03-engineering/database-schema.md
docs/03-engineering/api-specification.md

Then implement the property listing feature according to those specifications.

Do not introduce new business rules without identifying them first.
```

AI-generated code should be treated as implementation work, not as an automatic product decision.

If AI discovers a missing requirement, edge case, contradiction, or architectural problem, it should surface the issue rather than silently inventing a permanent rule.

---

# 17. Required Traceability

Where practical, development work should be traceable from:

```text
Product Requirement
        ↓
Domain / Business Rule
        ↓
API / Database / Architecture
        ↓
Implementation
        ↓
Tests
```

Example:

```text
Product Specification
"Providers may create property listings."

        ↓

Roles and Permissions
"Verified provider can CREATE_LISTING."

        ↓

Listing Rules
"Listing requires ownership/management authority."

        ↓

API Specification
POST /listings

        ↓

Backend
ListingService.create()

        ↓

Tests
provider-can-create-listing.spec
unverified-user-cannot-create-listing.spec
```

This traceability is especially important for permissions, money, verification, reputation, and moderation.

---

# 18. Security and Permission Changes

Changes affecting any of the following require particular care:

* authentication;
* authorization;
* account ownership;
* organization membership;
* verification;
* moderation;
* private information;
* audit logs;
* administrative actions;
* provider permissions.

Such changes should normally include:

1. specification update;
2. implementation update;
3. authorization tests;
4. security review where appropriate.

Never rely exclusively on frontend restrictions for security.

---

# 19. Database Changes

Database changes should remain consistent with:

```text
01-domain/domain-model.md
03-engineering/database-schema.md
```

Once production begins, schema changes should use migrations.

Do not manually alter production schema without capturing the change in the migration history.

Destructive migrations require additional review.

---

# 20. API Changes

Breaking API changes should be intentional and documented.

Changes to:

* endpoint behavior;
* required fields;
* response fields;
* authorization;
* state transitions;
* validation rules;

should update `api-specification.md`.

The frontend should not rely on accidental backend behavior.

---

# 21. Documentation Review Before Implementation

Before implementing a substantial feature, review the relevant documentation.

For example:

### Property listing development

Read:

```text
00-product/product-specification.md
01-domain/domain-model.md
01-domain/roles-and-permissions.md
01-domain/lifecycle-states.md
04-business-rules/listing-rules.md
03-engineering/database-schema.md
03-engineering/api-specification.md
```

### Review system development

Read:

```text
00-product/product-specification.md
01-domain/review-system.md
01-domain/lifecycle-states.md
04-business-rules/review-rules.md
04-business-rules/interaction-rules.md
```

### Verification development

Read:

```text
01-domain/verification-model.md
01-domain/roles-and-permissions.md
03-engineering/security.md
04-business-rules/fraud-prevention.md
```

---

# 22. Definition of Done for Documentation

A major specification is considered complete when:

* terminology is consistent;
* responsibilities are clear;
* important entities are defined;
* permissions are defined;
* lifecycle states are defined where relevant;
* edge cases have been considered;
* unresolved questions are explicitly marked;
* conflicting requirements have been resolved;
* related documents are referenced;
* behavior can reasonably be translated into tests.

Completeness does not mean the document can never change.

It means it is sufficiently clear to support implementation.

---

# 23. Current Documentation Authority

At the present stage of the project, the following documents represent the foundation of the marketplace:

```text
00-product/product-specification.md
01-domain/domain-model.md
```

These correspond to the approved:

* Product Specification V2;
* Core Domain Model.

They should be treated as foundational specifications when developing subsequent documents.

As additional specifications are approved, this section should be updated.

---

# 24. Recommended Documentation Build Order

The remaining specifications should generally be developed in this order:

```text
Product Specification
        ↓
Domain Model
        ↓
Roles & Permissions
        ↓
Lifecycle States
        ↓
Verification Model
        ↓
Review System
        ↓
Business Rules
        ↓
System Architecture
        ↓
Technology Decisions / ADRs
        ↓
Database Schema
        ↓
API Specification
        ↓
UX / User Flows
        ↓
Testing Strategy
        ↓
Development Roadmap
        ↓
Implementation
```

Some documents will evolve in parallel.

The objective is not to complete every possible document before writing code.

The objective is to make important decisions before implementation depends on them.

---

# 25. Guiding Rule

When there is uncertainty about what the application should do:

**Check the specification before checking the code.**

When there is uncertainty about how the application should implement an approved behavior:

**Check the engineering documentation and ADRs before inventing another architecture.**

When neither contains the answer:

**Treat it as an unresolved decision, make the decision explicitly, document it, and then implement it.**

---

# 26. Documentation Is Part of the Product

For this project, documentation is not administrative overhead.

It is part of the development system.

The repository should eventually allow a developer or AI system to understand:

* what the marketplace is;
* who uses it;
* how trust works;
* how properties are represented;
* how listings behave;
* how providers and seekers interact;
* how organizations operate;
* how reviews affect reputation;
* how verification works;
* how abuse is handled;
* how permissions are enforced;
* how the software is architected;
* how data is stored;
* how APIs behave;
* how features are tested;
* how the application is deployed and operated.

If an important part of the system cannot be understood from either the documentation or the code, that is a documentation gap that should eventually be corrected.
