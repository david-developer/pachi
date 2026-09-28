# ADR 0002 — Authentication and Sessions

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## Decision and product amendment

Use Cognito User Pools with managed login and OAuth/OIDC Authorization Code + PKCE. Initial methods are email/password, Google and Apple. This explicitly replaces the earlier phone-first primary-login proposal. Pachi's separate PHONE_OWNERSHIP verification remains required for saving, contact, messaging, viewings, reports and eligible reviews; provider/business claims remain separate.

Anonymous public browsing remains available. A new authenticated identity creates a PENDING_PHONE Pachi user. Phone OTP completion activates participation if account policy permits. Optional seeker ID is not a universal contact gate. No Cognito Identity Pools/client AWS credentials; API authorizes signed uploads.

Password storage/hashing/reset remain with Cognito; Pachi never stores plaintext passwords or password hashes. Configure a minimum 12-character password policy, support password managers/paste, and require reset after known compromise rather than arbitrary periodic rotation. Treat Apple private-relay addresses as valid distinct contacts; do not infer their underlying email. Use PKCE S256, state and nonce as appropriate; the implicit grant is prohibited.

## Application identity and linking

Pachi owns immutable user IDs and unique `(issuer, subject)` mappings. Email is not a primary key and equal email never auto-merges users. Store provider/contact verification separately from domain assurance. Multiple identities may link to one user only after proving control of both through fresh authenticated flows, collision checks and an audited server-side linking operation. Preserve one stable Pachi user and all history.

If a social identity matches an existing email, show safe sign-in/link guidance; do not silently create a privileged link. Link/unlink requires recent authentication, current session and secure recovery path remaining. Reject account linkage with another existing Pachi principal unless a dedicated reviewed recovery/merge procedure explicitly resolves ownership. No email-only support override.

## Clients and sessions

| Client | Required implementation |
|---|---|
| Mobile | Public Cognito client without client secret; system browser auth code + PKCE/state/nonce, exact callback allowlist, secure platform token storage. Never embedded webview credentials or tokens in ordinary SQLite/logs. |
| Marketplace web | Confidential server-side OIDC client using `openid-client`; tokens stored encrypted in a server session store, browser gets opaque Secure/HttpOnly/SameSite cookie. No browser localStorage tokens. |
| Staff web | Separate Cognito app client and Next.js app, confidential server flow, local Cognito identity with mandatory TOTP, explicit StaffGrant. Public registration never grants staff access. |

Web mutations enforce CSRF protection and origin checks; SameSite alone is not the entire control. Cookies are host-only with restricted path, regenerated on login/privilege change and invalidated on logout. Redirect targets are allowlisted. Mobile deep-link verification prevents arbitrary app interception where platform support permits.

Use Cognito access tokens for API authorization, not ID tokens. Validate signature/algorithm, issuer, expiry, `token_use=access`, accepted `client_id` and required scopes; validate audience where configured rather than assuming every access token has an ID-token audience. JWKS caching must handle rotation safely without accepting unknown issuer/algorithm.

## Rotation and immediate revocation

Enable refresh-token rotation and token revocation. Use token endpoint/SDK flows compatible with rotation; do not use incompatible legacy refresh auth flows. Access token TTL: 5 minutes. Marketplace absolute session/refresh lifetime: 30 days, with server idle expiry after 7 days. Staff absolute session: 8 hours, idle expiry: 30 minutes. These are maximums; application checks can terminate earlier than the identity-provider token lifetime.

Register each token family using issuer/app client/origin_jti in SecuritySession. API registration validates the signed token and mapping; a revoked token-family tombstone cannot be registered again. Every authenticated request checks current session/account state. Logout revokes application session first, invokes provider refresh revocation, clears local credentials/cookies, and invalidates relevant device notification associations. Logout-all increments security version and revokes all mapped sessions. A JWT signature/expiry check alone does not guarantee immediate logout enforcement.

Do not cache authorization in a way that permits revoked membership/session continuation. Handle concurrent refresh with per-session single-flight/locking and bounded rotation grace; start with a 10-second provider grace window and verify concurrent client behavior. A suspicious replay triggers session revocation and safe recovery. Tokens/refresh credentials never appear in logs, URLs, analytics or error reports.

## MFA, step-up and recovery

Staff require local Cognito TOTP MFA. Sensitive staff actions require server-recorded recent reauthentication/MFA within 15 minutes; do not accept a client boolean saying MFA occurred. Normal consumer optional TOTP is deferred, but sensitive organization ownership/admin-grant changes require an MFA-backed step-up path. An owner signed in only through federation must establish and prove a local step-up identity through the controlled linking flow before performing those actions; no bypass based on social email equality.

Initial owner onboarding explains this requirement before ownership transfer/admin delegation. Recovery when all owner authenticators are lost uses a scoped staff case with independent evidence, delays/notifications as risk requires and immutable audit. It cannot assign ownership to whoever controls an email address today.

Cognito manages password reset and sign-in email verification. Pachi manages phone-change verification and domain permissions. Recovery cannot elevate provider/business/property claims; it may temporarily restrict publishing/contact until risk checks complete. No security questions. Rate-limit login/OTP/recovery and use neutral responses.

If Cognito is unavailable, no new login/refresh; already issued access tokens remain usable only while cryptographically valid and application session/account checks pass. Never fail open or mint ad hoc production tokens. Local tests use an isolated test issuer with a different issuer/key; production config rejects that issuer and any mock-OTP mode.

## Configuration and launch evidence

Separate staging/prod pools, clients, secrets and callbacks. Store client secrets only server-side; mobile/public config contains only public identifiers. Staff app uses restricted CORS/redirects and no shared cookies with marketplace web. Audit identity linking, recovery, phone change, session revocation, MFA changes and privileged authentication without secrets.

Design choices above are settled. Before real users, demonstrate all login methods, account collision/linking, phone gate, session expiry/revocation, cookie/CSRF behavior, lost-device recovery, MFA/step-up, and provider outage behavior. Google/Apple developer setup, provider limits/cost and managed-login UX are launch evidence, not assumed completed tasks. Final provider compatibility/version checks belong in the implementation PR.

## Primary technical references

- [Cognito refresh-token rotation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
- [Cognito token revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
- [Cognito token endpoint and PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
- [Cognito access-token claims](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)

These references support provider mechanics. Pachi session lifetimes, linking restrictions and phone gates are project decisions, not vendor defaults.
