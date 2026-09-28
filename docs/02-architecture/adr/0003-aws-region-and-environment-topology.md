# ADR 0003 — AWS Region and Environment Topology

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Decision

Use isolated staging and production AWS accounts, a management account and a separate backup/security account before live launch. Initial deployment configuration targets `eu-west-1` (Ireland), with `eu-west-3` (Paris) for recovery copies. These are deployment defaults, not a claim of measured Cameroon latency. Before provisioning the live pilot, compare target response time and costs; a material failure requires a recorded update of this ADR and IaC before deployment.

One active backend region with multiple Availability Zones; no active-active application/database writes. Secondary region provides recoverability, not assumed automatic failover. Local scaffolding does not require AWS accounts, live credentials, NAT gateways or deployed production infrastructure.

## Topology

| Component | Staging | Production |
|---|---|---|
| Network | Own VPC, private app subnets and isolated database subnets | Own VPC across at least two AZs; public ingress only at approved load balancer/CDN paths |
| API | ECS Fargate, small synthetic workload | ECS Fargate behind TLS ALB, at least two healthy tasks across AZs before public launch |
| Worker | Separate service/task using same release image/domain modules | Queue-aware scaling; no public ingress |
| PostgreSQL/PostGIS | RDS Single-AZ permissible; no production evidence copies | Private RDS Multi-AZ before public launch, encrypted, controlled migration role |
| Storage | Separate environment buckets, synthetic data | Separate public-origin/quarantine/private-evidence buckets, encryption and lifecycle/hold controls |
| SQS | Separate queues/DLQs | Queue/DLQ by workload, encryption, constrained IAM |
| Identity | Dedicated Cognito pool and clients | Dedicated pool/clients; staff app separation and MFA |
| Next.js | Separate Vercel project/environment per web/admin | Separate projects/secrets/callbacks and deployment access |
| Secrets | Environment-specific secret store | Secrets Manager, least-privilege access, audited rotation |

Production RDS must not have a public endpoint. App security groups accept only approved load balancer traffic; database groups accept only application/migration identities and controlled operations paths. No routine public SSH/bastion. Use managed session access or a scoped temporary task with an audit record. Deny broad internet database ingress even temporarily.

NAT policy is settled: one NAT per active production AZ to avoid one-AZ egress dependency; staging may use one to reduce cost. Use available service endpoints for approved AWS traffic where justified by cost/security review. IAM and security groups restrict access regardless of endpoint placement. The cost gate must explicitly include NAT, ALB, RDS, Fargate, logs, backups, S3/egress, Cognito and notifications. If unaffordable, revise the topology before provisioning rather than silently omitting recovery/security requirements.

## Delivery and account security

AWS Organizations controls separate account responsibilities. Root credentials are not for routine use; enforce strong root protection, recovery contacts and billing alerts. CI deploys through GitHub OIDC with repository/environment/branch restrictions and narrowly scoped roles. No permanent AWS keys in repository or GitHub secrets. Separate build, infrastructure, migration and runtime permissions.

CDK stacks are versioned and environment-configured. Preview a change set/diff before applying; protected resources need deletion protection/retention according to recovery policy. Production data is never an incidental teardown target. Tag environment, service, owner and cost center. DNS/TLS, Vercel domains and mobile callback configuration are tracked with the release.

## Backups, recovery and deletion

Initial deployment defaults: database automated recovery retention 35 days; daily recovery copy to the backup/security account and secondary region retained 35 days. Validate service support, encryption/key access and achievable replication lag during implementation; no feature is assumed merely from its name. Application role cannot delete recovery points or backup keys. Protect backup configuration and record restore tests.

Use S3 versioning and lifecycle by data classification. Private evidence backup/version retention must match the approved privacy schedule; blanket indefinite retention or Object Lock is not allowed on evidence without that policy. Deletion tombstones/hold records are included in recovery and reapplied after restore. Public immutable derivatives may have different retention from source/evidence objects.

Targets: in-region RPO ≤1 hour/RTO ≤8 hours; regional RPO ≤24 hours/RTO ≤24 hours. Demonstrate database, media, keys, configuration, identity, callback/DNS and queues together. Backup existence is not a passed restore gate.

## Authentication during regional recovery

Do not assume a database backup also recovers Cognito credentials, MFA or user-pool subjects. The initial DR design uses IaC for a recovery pool/client configuration plus a tested identity-recovery procedure and preserved Pachi AuthIdentity mappings. Provider-supported replication/export behavior must be verified in the implementation; passwords are never exported by the application.

If the original identity service is unavailable, remain in maintenance/recovery mode until a verified reauthentication or recovery path can safely bind users to new issuer/subject values. No automatic email-based linking. Staff use a separately rehearsed controlled recovery identity and evidence/audit process. E04 requires a demonstrated end-to-end identity recovery path within the stated target before production; if unsupported, revise the target/topology explicitly before launch. This is a release evidence requirement, not an invented cloud guarantee.

## Region/cost validation

Test Ireland/Paris and reasonable alternatives from actual Cameroon networks when available: repeated TLS/API latency, p95 variability, packet loss, mobile upload and SMS/auth paths. A geographic map alone is insufficient. Record workload, operator/network, times and sample counts. Use current official pricing/configuration when estimating; this document contains no asserted vendor price.

There are no competing architecture choices left for a coding agent to guess. Region suitability, account setup, cost approval and restore performance remain named E03/E04 evidence gates in the [readiness checklist](../../03-operations/production-readiness-checklist.md).
