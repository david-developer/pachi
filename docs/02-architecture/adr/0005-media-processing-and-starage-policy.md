# ADR 0005 — Media Processing and Storage

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Decision and classification

Use S3 with private origins; public approved marketplace derivatives are delivered through CloudFront. Private verification/case evidence uses separate buckets/permissions and never the public distribution. Public bucket ACLs are not the publication mechanism. Media metadata/ownership is authoritative in PostgreSQL.

| Class | Access and use |
|---|---|
| PUBLIC_MARKETPLACE | Private upload/quarantine/original; only approved derivatives eligible for public delivery. |
| PRIVATE_EVIDENCE | Verification and case evidence, private original and reviewer-safe preview, short-lived authorized access only. |
| MESSAGE_ATTACHMENT | Reserved early-release capability; participant-scoped, abuse/retention gate required. Not enabled merely because generic media supports files. |

## Upload contract and limits

API checks actor, principal/resource scope, type/classification, quota and state before issuing a single-purpose upload authorization. Server generates unpredictable object key; client cannot choose bucket, ownership, classification or arbitrary key. Default upload URL lifetime 5 minutes; bind content type, size/checksum constraints where supported. On completion, independently verify object metadata/bytes against the authorized record. Signed URL possession is not permission to attach the object to another listing/case.

Initial marketplace limits: JPEG/PNG/WebP, at most 20 images per listing, 15 MiB per original, at most 40 megapixels decoded. HEIC/HEIF input must be converted by a controlled client/server path into an accepted format, or rejected with clear guidance until that decoder is deployed and tested. Do not promise support from a filename alone. Verification evidence: JPEG/PNG/PDF, up to 20 MiB per file and 10 files per case, with secure preview; no SVG/HTML/executable formats. Limit PDF pages to 20 for intake, rejecting unsupported/encrypted files with remediation.

These are versioned product-operational defaults, adjustable after upload testing. Quotas apply per account/principal, in-flight upload count and storage, with rate controls. An abandoned upload is not a trusted asset.

## Processing pipeline

1. Authorize upload and create MediaAsset UPLOAD_AUTHORIZED.
2. Confirm upload → UPLOADED_QUARANTINED; enqueue idempotent processing via outbox.
3. Inspect true file signature/type, byte/pixel/page limits, decompression behavior and checksum. Reject type mismatch, polyglot/unsafe content and malformed files.
4. Scan using a maintained ClamAV-based worker/container with signature updates, resource limits and no unnecessary network access. Failure/unavailable scanning keeps content quarantined; never fail open. Secure PDF rendering also runs in a constrained process.
5. Decode/re-encode marketplace images with a maintained image library, correct orientation, strip EXIF/GPS/unneeded metadata, generate bounded derivatives and hashes. Keep canonical original private only for its approved retention period.
6. Generate widths 320, 640, 1280 and 1920 without upscaling, with format/quality chosen against visual/data-cost checks; record MIME/bytes/dimensions. Reviewer previews cannot execute embedded content.
7. Mark processing READY only after all technical checks. Listing/content moderation separately approves public attachment; READY does not mean publicly published.
8. Record failures with safe reason codes, retry transient failures, reject permanent validation failures and notify applicant without exposing scanner internals.

Malware detection is not proof that content is appropriate or authentic. Launch content moderation is manual; automated image-content scoring is deferred until evaluated. Perceptual hashes support duplicate investigation, not automatic public fraud accusations. No face recognition or identity inference is introduced through media processing.

## Delivery and authorization

CloudFront reads only approved derivative origin paths; bucket remains private. Use immutable versioned derivative keys and correct MIME/cache headers. Private evidence keys and original source keys never appear in public DTOs, HTML, metadata or notifications. Evidence access requires fresh case authorization/step-up where applicable and at most 60-second URL lifetime; record actor, purpose and target. A signed URL is bearer access, so keep its lifetime and logging exposure bounded.

Safety removal first suppresses the listing/media reference and denies fresh access, then invalidates relevant CDN objects/HTML and purges caches as needed. Previously downloaded public media cannot be recalled; do not falsely guarantee retroactive deletion from users' devices. Private evidence must never have entered that public path.

Listing media associations require same authorized provider scope and approved resource use. Property duplicates/merges do not grant unrelated providers access to originals/evidence. Prevent enumeration via storage keys and redact URLs from logs/traces.

## Retry, retention and deletion

Jobs are idempotent by media ID/input version/processor version. A retry cannot duplicate derivatives or publish a failed asset. DLQ entries contain identifiers and safe failure categories, not file contents. Cap attempts and expose processing state to clients. Multipart/abandoned uploads expire after 24 hours; quarantine rejected uploads are deleted after 7 days unless a valid case hold and approved schedule require otherwise.

Published derivatives remain only while referenced and permitted. Unreferenced public source/derivative defaults: 30-day cleanup grace. Real verification evidence uses gate E01's approved retention schedule; synthetic local default is 30 days after case closure. Preserve needed evidence originals under explicit holds, not indefinite default retention.

Deletion resolves every original, derivative, preview, object version and association; mark tombstone, execute idempotently, record completion/failure, and reconcile orphan objects. Holds have owner/reason/review date. Backup restores replay tombstones and retention rules. Public and private lifecycle policies differ; no blanket Object Lock or everlasting backup copy for identity evidence.

## Security and monitoring

Separate processing/public-serving/evidence-review/delete IAM roles; least privilege, encryption/KMS, per-environment buckets, private network where supported. Monitor quarantine age, processing failures, scan signature age, DLQ, storage growth, unauthorized access, deletion backlog and cost. No sensitive file contents in logs/Sentry. Alert if signature updates or deletion jobs stop.

## Acceptance evidence

Test oversized/malformed/renamed/polyglot images, decompression bombs, invalid/encrypted PDF, scanner outage, EXIF removal, checksum mismatch, cross-owner attach/read, failed-processing publication, private/public separation, URL expiry, safe preview, retry duplicates, orphan cleanup, hold/deletion and restored tombstones. Demonstrate upload behavior on representative low-bandwidth devices before pilot. Pin decoder/scanner/container versions at implementation and maintain updates.
