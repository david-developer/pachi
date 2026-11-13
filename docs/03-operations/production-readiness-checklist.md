# Pachi — Foundation, Pilot and Production Readiness

> **Status:** Accepted implementation baseline  
> **Baseline:** Pachi 2.1  
> **Updated:** 2026-09-24  
> Acceptance establishes the design to implement; it does not certify implementation, testing, vendor readiness, or launch readiness.

## How to use this checklist

This checklist covers staged gates, not just infrastructure launch. An item without explicit recorded evidence remains NOT RUN; document acceptance alone is not a test result. Current implementation and dated evidence are recorded in the single [engineering handoff](../engineering/current-state.md); gate completion requires every applicable item, not an authentication milestone. G0, G1 and G2 are recorded complete below; G3–G6 remain incomplete. G2 is the recorded individual-provider synthetic/local TEST slice, not real-account, pilot or production acceptance.

For each completed item record commit/release, environment, date, operator responsibility, evidence link, result and any expiry/retest condition. `[ ]` means not demonstrated; `[x]` may be used only with evidence. Failed, not-run and not-applicable are distinct; not-applicable needs a reason tied to scope. The project owner may hold multiple responsibilities but must not invent independent staff sign-off.

No exception can waive unauthorized access, private-evidence exposure, unresolved critical security/data-loss defects, missing core marketplace functionality or an untested recovery path. A noncritical exception records affected requirement, mitigation, expiry, owner and release impact; it cannot silently redefine the product.

### Temporary dependency-audit exceptions

The dependency audit remains configured at the `low` threshold. A temporary exception is not a remediation and is permitted only when the exact GHSA is named, no released compatible fix exists, dependency provenance and runtime/build exposure are assessed, compensating controls are recorded, and an owner, review-by date, and removal trigger are explicit. Every other advisory remains blocking at the configured threshold. Wildcards, registry-error suppression, reduced severity, and ignore-unfixable behavior are not permitted.

The owner explicitly approved only the two minimatch records below on2026-11-13 for development/CI, expiring2026-11-20T00:00:00Z without automatic renewal. Conditional reuse was separately authorized after correcting qs6.16.1 to6.16.2 and checking current advisories/exposure. The approval does not fix minimatch or approve production deployment. Exact package/parent/importer graph guards and UTC cutoff fail closed; all other strict-low findings and registry errors remain blocking. Untrusted runtime reachability, graph/exposure drift or an additional relevant finding invalidates this acceptance immediately. Retired/withdrawn records retain their original dates and decisions; deepmerge was eliminated and its November4 expiry was not renewed.

- **Advisory:** `GHSA-g3hv-75wg-m249` ([official advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)); MODERATE; globparts preprocessing amplification.
- **Remaining uncertainty:** The advisory describes amplification with optimizationLevel>=2; normal fingerprint calls use1. That narrows the demonstrated trigger but does not remove the vulnerable package or justify a clean audit claim.
- **Package:** `minimatch@10.2.6` only through `@expo/fingerprint@0.16.5` under `apps/mobile` / `expo@55.0.0`; six equivalent Expo ancestry paths converge on that one exact parent edge. All other installed minimatch versions/parents are outside this acceptance.
- **Provenance:** official npm package/lock integrity; reviewed Phase1/2 Expo backports remain unchanged. [Expo's November2 assessment](https://github.com/expo/expo/issues/52735#issuecomment-6589492700) describes development tooling and project-controlled inputs; [its November6 follow-up](https://github.com/expo/expo/issues/52735#issuecomment-6686276582) retains minimatch10 because replacing it changes behavior. These comments predate the November11 escape-contract advisory and do not assess it. Pachi's separate no-escape-call evidence and uncertainty below apply to that advisory. Neither upstream statement grants Pachi production approval or proves universal non-exploitability.
- **Runtime/build exposure:** fingerprint builds Minimatch objects in utils/Path.js with dot:true/default optimizationLevel1, using repository-owned default/config/options/.fingerprintignore/dirExcludes/CNG/plugin exclusion inputs. No escape() call or untrusted application runtime input path was found. Phase2 native/web source-map evidence excludes fingerprint/minimatch tooling; this remains bounded evidence, not a universal runtime guarantee.
- **Reason:** no equivalent SDK55-compatible elimination is established. The evaluated minimatch11 and upstream-proposed picomatch adapter change documented matching behavior or public fingerprint hashes. The owner explicitly accepted this remaining unfixed risk on 2026-11-13 for development/CI only under these exact conditions.
- **Compensating controls:** trusted reviewed configuration/plugins/ignore patterns and frozen integrity-pinned dependencies only; clean-environment local TEST without loading/passing production credentials or data, and fresh GitHub CI using only synthetic settings without production secrets; existing local credential files remain preserved and are not claimed to be sandbox-inaccessible; preserve strict-low and unfiltered/production audit evidence; guard exact lockfile versions/parent edges; do not accept external configuration, glob patterns or plugin code; retain all mandatory assertions and security compatibility regressions; deployment remains blocked. Stop on path/version drift, untrusted runtime reachability or any additional relevant advisory. Retire on compatible remediation or deadline, whichever comes first; no automatic extension.
- **Owner:** Pachi project owner.
- **Created on:** 2026-11-13.
- **Reviewed on:** 2026-11-13.
- **Owner decision on:** 2026-11-13.
- **Owner decision:** ACCEPTED ONCE for development/CI only under the exact documented conditions; no automatic renewal or production deployment approval.
- **Risk history:** Proposed on 2026-11-13 and kept inactive pending approval. The owner explicitly approved the exact two-advisory/package/parent/deadline/controls on 2026-11-13 and authorized validation and conditional commit/push/CI qualification; merging and deployment remain unauthorized. No earlier minimatch acceptance is inferred. All retired deepmerge/Forge and withdrawn braces/sprintf records retain their original decisions and dates. This acceptance does not reset or extend them. The initial qualification stopped on a newly identified qs advisory; the owner subsequently authorized only its scoped6.16.2 correction and conditional reuse of this original approval. After actual qs correction and a bounded current advisory/path check found no additional unaccepted finding or exposure change, this same approval was reactivated on2026-11-13. Owner, scope, compensating controls, original dates, November20 cutoff and production prohibition are unchanged.
- **Review by:** 2026-11-20 00:00 UTC (2026-11-20T00:00:00Z); reject at and after this exact instant.
- **Removal trigger:** earliest of a compatible verified correction, changed dependency/exposure assumptions, new relevant finding, or the fixed expiration. No automatic renewal.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES — development/CI only until 2026-11-20T00:00:00Z; production deployment remains blocked.

- **Advisory:** `GHSA-c859-jr93-m5j4` ([official advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-c859-jr93-m5j4)); MODERATE; escape() literal-matching contract failures.
- **Remaining uncertainty:** The upstream range includes10.2.6, although the current npm/global feed omits this identity. Fingerprint does not call escape(); this observed non-use does not prove every possible tool/plugin/runtime path safe.
- **Package:** `minimatch@10.2.6` only through `@expo/fingerprint@0.16.5` under `apps/mobile` / `expo@55.0.0`; six equivalent Expo ancestry paths converge on that one exact parent edge. All other installed minimatch versions/parents are outside this acceptance.
- **Provenance:** official npm package/lock integrity; reviewed Phase1/2 Expo backports remain unchanged. [Expo's November2 assessment](https://github.com/expo/expo/issues/52735#issuecomment-6589492700) describes development tooling and project-controlled inputs; [its November6 follow-up](https://github.com/expo/expo/issues/52735#issuecomment-6686276582) retains minimatch10 because replacing it changes behavior. These comments predate the November11 escape-contract advisory and do not assess it. Pachi's separate no-escape-call evidence and uncertainty below apply to that advisory. Neither upstream statement grants Pachi production approval or proves universal non-exploitability.
- **Runtime/build exposure:** fingerprint builds Minimatch objects in utils/Path.js with dot:true/default optimizationLevel1, using repository-owned default/config/options/.fingerprintignore/dirExcludes/CNG/plugin exclusion inputs. No escape() call or untrusted application runtime input path was found. Phase2 native/web source-map evidence excludes fingerprint/minimatch tooling; this remains bounded evidence, not a universal runtime guarantee.
- **Reason:** no equivalent SDK55-compatible elimination is established. The evaluated minimatch11 and upstream-proposed picomatch adapter change documented matching behavior or public fingerprint hashes. The owner explicitly accepted this remaining unfixed risk on 2026-11-13 for development/CI only under these exact conditions.
- **Compensating controls:** trusted reviewed configuration/plugins/ignore patterns and frozen integrity-pinned dependencies only; clean-environment local TEST without loading/passing production credentials or data, and fresh GitHub CI using only synthetic settings without production secrets; existing local credential files remain preserved and are not claimed to be sandbox-inaccessible; preserve strict-low and unfiltered/production audit evidence; guard exact lockfile versions/parent edges; do not accept external configuration, glob patterns or plugin code; retain all mandatory assertions and security compatibility regressions; deployment remains blocked. Stop on path/version drift, untrusted runtime reachability or any additional relevant advisory. Retire on compatible remediation or deadline, whichever comes first; no automatic extension.
- **Owner:** Pachi project owner.
- **Created on:** 2026-11-13.
- **Reviewed on:** 2026-11-13.
- **Owner decision on:** 2026-11-13.
- **Owner decision:** ACCEPTED ONCE for development/CI only under the exact documented conditions; no automatic renewal or production deployment approval.
- **Risk history:** Proposed on 2026-11-13 and kept inactive pending approval. The owner explicitly approved the exact two-advisory/package/parent/deadline/controls on 2026-11-13 and authorized validation and conditional commit/push/CI qualification; merging and deployment remain unauthorized. No earlier minimatch acceptance is inferred. All retired deepmerge/Forge and withdrawn braces/sprintf records retain their original decisions and dates. This acceptance does not reset or extend them. The initial qualification stopped on a newly identified qs advisory; the owner subsequently authorized only its scoped6.16.2 correction and conditional reuse of this original approval. After actual qs correction and a bounded current advisory/path check found no additional unaccepted finding or exposure change, this same approval was reactivated on2026-11-13. Owner, scope, compensating controls, original dates, November20 cutoff and production prohibition are unchanged.
- **Review by:** 2026-11-20 00:00 UTC (2026-11-20T00:00:00Z); reject at and after this exact instant.
- **Removal trigger:** earliest of a compatible verified correction, changed dependency/exposure assumptions, new relevant finding, or the fixed expiration. No automatic renewal.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES — development/CI only until 2026-11-20T00:00:00Z; production deployment remains blocked.

Phase 1 retired the exact withdrawn braces and sprintf-js suppressions without changing their installed packages. Their original decisions and November 13 deadlines remain verbatim below. Forge's October 28 retirement is historical; its current resolution is separately verified1.4.3.


Historical October 11 decision (superseded only by the separately authorized October 14 acceptance above): on 2026-10-11, the project owner explicitly approved a temporary three-day extension of only the sprintf review deadline from October 13 to October 16. The October 11 investigation found no qualifying released compatible correction and no newly demonstrated runtime or attacker-controlled formatting path; its artifact and reachability limitations remain. This is risk acceptance of an **unfixed vulnerability**, with no real-user deployment authorization. The original October 6 creation date and 14-day maximum remain unchanged. All three exceptions require a fresh security decision before their hard stopping boundary, **2026-10-16 00:00 UTC**; no further extension is authorized. See the [decision observation](../engineering/current-state.md#sprintf-js-three-day-review-extension--authorized--2026-10-11).

Fresh October 14 assessment: one unfiltered audit of the unchanged lockfile returned exactly node-forge 1.4.0 / HIGH, braces 3.0.3 / HIGH, and sprintf-js 1.0.3 / MODERATE, with no audit error or new advisory. Frozen installation confirms those exact versions. Official npm metadata still publishes no patched target release: latest node-forge 1.4.0, braces 3.0.3 and affected sprintf-js 1.1.3. Compatible Expo 55 CLI/signing, React Native 0.83, Metro/micromatch and Babel/Jest/NYC chains retain the vulnerable dependencies. Latest js-yaml 5 is a major schema migration; the previously rejected Argparse overrides remain rejected. Forge PR #1152 and sprintf PR #239 remain open/unmerged; braces PRs #72/#75 closed without merge. Existing provenance and export-map/deployment-trace reports are reused. Package manifests, lockfile and workflows are byte-identical to the October 11 integration; narrow added-source checks and current API/web/admin/worker production graphs establish no newly introduced sensitive runtime or attacker-controlled vulnerable input path. Prior bundle evidence is historical and cannot prove universal non-exploitability. Repository-controlled build/configuration inputs, isolated development work without production environment files, and fresh read-only GitHub-hosted CI with synthetic TEST settings remain required. Any new direct import, externally controlled certificate/signature, glob pattern or format string reaching these packages, shipped sensitive runtime path, materially higher severity/exploitation evidence, or unexpected package-set change invalidates this acceptance immediately. All three vulnerabilities remain **unfixed**. No production, cloud, real-account or broader G3 approval follows.

## Retired deepmerge dependency-audit exception

Retired on 2026-11-12 after elimination from both @expo/config12.0.14 and55.0.21, using reviewed Expo #52602 backports. The original November4 expiry was never extended. The record below is preserved verbatim as historical evidence, including its obsolete availability and acceptance statements; none grants current permission. The candidate contains no installed or locked deepmerge package. Other findings remain independently blocking.

- **Advisory:** `GHSA-gcqx-w48m-w2h4` ([GitHub Advisory Database](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)).
- **CVE:** `CVE-2026-93753`; LOW severity. Prototype poisoning of returned merged objects remains a real tooling defect.
- **Package:** `deepmerge@4.3.1`; no released compatible patched version or dependency elimination was established on 2026-10-28.
- **Created on:** 2026-10-28.
- **Provenance:** the two direct installed consumers are `@expo/config@12.0.14` and `@expo/config@55.0.21`, each declaring `deepmerge ^4.3.1`. Their `modifyConfigAsync` / `mergeConfigModifications` paths edit project configuration and plugin properties. The full locked dependency graph and exact consumer implementation hashes are retained in the October 28 assessment.
- **Runtime/build exposure:** bounded `dryRun:true` probes against both actual consumers reproduce prototype poisoning of returned configuration; global Object.prototype and fixture files remain unchanged. Project files, plugin options and tool-supplied modifications control these inputs; no public listing/contact/API data path was identified. The ordinary controlled config-read path did not load deepmerge. Fresh Android/iOS/web export maps contain 1101/1105/818 sources and no deepmerge or @expo/config source. That observed tooling boundary does not exclude arbitrary vendored/minified copies, future runtime exposure or unreviewed project/plugin inputs.
- **Reason:** [latest deepmerge](https://registry.npmjs.org/deepmerge/latest) remains affected 4.3.1; compatible Expo configuration releases and latest config 58 retain it. No compatible published fix or elimination was established; [upstream PR #274](https://github.com/TehShrike/deepmerge/pull/274) is closed/unmerged. Another merge library, downgrade, unaudited fork or Expo SDK migration changes unproven configuration/plugin semantics and is not an approved audit-only repair.
- **Compensating controls:** reviewed repository configuration, plugins and locked graph only; no untrusted projects or public marketplace inputs in configuration-edit tooling. Use fresh hosted read-only CI with synthetic TEST settings and no production credentials or signing material. Preserve bounded regressions and runtime-boundary evidence. Strict-low auditing, the exact named allowlist and all other findings/registry errors remain blocking. These controls do not fix prototype poisoning or prove universal non-exploitability.
- **Owner:** Project owner / repository maintainer.
- **Reviewed on:** 2026-10-28.
- **Owner decision on:** 2026-10-28.
- **Owner decision:** ACCEPTED ONCE for development/CI only; no automatic extension, merge or deployment approval.
- **Risk history:** first recorded and investigated on 2026-10-28 after the fresh integration audit failed. The proposal remained explicitly unapproved and unconfigured during assessment. After reviewing actual tooling exposure, bounded probes, released-fix assessment and fresh export limitations, the owner explicitly approved only this exact finding for seven days. The separate October 14 braces/sprintf-js decisions and November 13 deadlines are unchanged; Forge remains retired. No production, pilot or G3 acceptance follows.
- **Review by:** 2026-11-04.
- **Removal trigger:** immediately remove/reassess on a published compatible fix or parent update eliminating every path; new direct, runtime or untrusted-input exposure; changed consumers or plugin trust boundaries; materially higher severity or exploitation evidence. The hard stopping boundary is 2026-11-04 00:00 UTC (03:00 Europe/Istanbul), seven days after assessment; the deadline day itself blocks, with no automatic extension. Production deployment remains blocked and requires separate approval.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES, development/CI only until 2026-11-04 00:00 UTC; no merge or deployment approval.

## Withdrawn dependency-audit exceptions

Retired on 2026-11-12 (Europe/Istanbul) after authoritative withdrawal verification within the owner-authorized Phase 1 scope. This closes obsolete suppressions, not package defects, and grants no new risk acceptance. The verbatim records below describe historical assessments; their unfixed/accepted labels are not current permissions. Original approval dates and November 13 deadlines remain unchanged.

### braces: withdrawn advisory, unchanged package

GitHub withdrew [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) on 2026-10-23: not a practically exploitable vulnerability. Current installed tooling paths and versions remain unchanged; no direct Pachi product import or new runtime path was identified. Fresh export evidence is recorded in the handoff.

- **Advisory:** `GHSA-vfj7-8cjw-p6xm` ([GitHub Advisory Database](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)).
- **CVE:** `CVE-2026-93687`; HIGH severity, CVSS v4 8.7 (v3.1 7.5), verified from GitHub's advisory API on 2026-10-05. Deeply nested brace patterns can exhaust the stack and terminate a Node.js process.
- **Package:** `braces@3.0.3`; affected versions `<=3.0.3`, no patched version, [npm latest](https://registry.npmjs.org/braces/latest) remains 3.0.3. Upstream fix PRs [micromatch/braces#72](https://github.com/micromatch/braces/pull/72) and [#75](https://github.com/micromatch/braces/pull/75) are closed/unmerged/unreleased as of the October 14 assessment; neither is a published fix.
- **Created on:** 2026-10-05.
- **Provenance:** `pnpm why braces`, recursive production queries and the lockfile establish three families: mobile Babel/Jest (`react-native@0.83.0` → `babel-jest@29.7.0` → `@jest/transform@29.7.0` → `jest-haste-map@29.7.0` → `micromatch@4.0.8` → `braces@3.0.3`, also direct transform/message-util paths); mobile Metro/Expo (`react-native@0.83.0` → `@react-native/community-cli-plugin@0.83.0` → `metro@0.83.8` → `metro-file-map@0.83.8` → `micromatch@4.0.8` → `braces@3.0.3`, plus `expo@55.0.0` → `@expo/cli@55.0.11` → `@expo/metro@54.2.0` → `metro-file-map@0.83.3` → `micromatch@4.0.8` → `braces@3.0.3`); root/shared lint tooling (`@typescript-eslint/parser@8.44.0` → `@typescript-eslint/typescript-estree@8.44.0` → `fast-glob@3.3.3` → `micromatch@4.0.8` → `braces@3.0.3`). pnpm audit reports 100 representative/deduplicated paths, not an exhaustive count.
- **Runtime/build exposure:** mobile's installed production dependency graph includes the React Native/Expo Babel/Jest and Metro tooling families. API, marketplace web, admin and worker production graphs have no braces path, but all use shared development lint tooling. No direct Pachi source import exists. Shipped runtime reachability and attacker-controlled pattern reachability are not established; lack of a direct import does not make the vulnerability harmless. Production bundle inspection is recorded separately in the engineering handoff.
- **Reason:** no released compatible remediation eliminating all vulnerable paths was found. [Latest micromatch 4.0.8](https://registry.npmjs.org/micromatch/latest) still declares `braces ^3.0.3`; compatible React Native 0.83.10 retains Babel/Jest 29.7 and Metro file-map 0.83.8 retains micromatch. Expo SDK 55.0.31 / CLI 55.0.36 does not eliminate those paths. Newer Jest/ESLint releases remove some individual paths, but do not remove all current mobile tooling paths. No application dependency or lockfile is changed.
- **Compensating controls:** strict audit threshold remains `low`; the guard enforces the exact approved GHSA set, per-record original creation history and this record's unchanged one-time 30-day review window. All other advisories and registry errors remain blocking. No wildcard, package-name suppression, ignore-unfixable option, unreviewed fork or unreleased commit is used. Maintain existing bounded inputs and review any future glob/pattern integration; no claim that current controls fix stack exhaustion.
- **Owner:** Project owner / repository maintainer.
- **Reviewed on:** 2026-10-14.
- **Owner decision on:** 2026-10-14.
- **Owner decision:** ACCEPTED ONCE for development/CI only; no automatic extension or production deployment approval.
- **Risk history:** Created 2026-10-05 after failed exact-main Checks 37236836981, with review due 2026-10-16. The October 5 report described upstream fix PRs as open; fresh October 14 API evidence shows both closed without merge or release. On 2026-10-14, the owner separately accepted the same unresolved risk once for development/CI through the November 13 boundary.
- **Review by:** 2026-11-13.
- **Removal trigger:** remove this exception on a patched braces release or compatible upstream dependency update eliminating all vulnerable paths. Re-run the unfiltered audit, mobile exports and full CI pipeline; each advisory retains its separate identity and risk record.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES.

### sprintf-js: withdrawn advisory, unchanged package

GitHub withdrew [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) on 2026-10-22: applications are responsible for handling exceptions appropriately. Current installed tooling paths and versions remain unchanged; no direct Pachi product import or new runtime path was identified. Fresh export evidence is recorded in the handoff.

- **Advisory:** `GHSA-hp3w-g68c-fv3c` ([GitHub Advisory Database](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)).
- **CVE:** `CVE-2026-97058`; MODERATE severity. Published 2026-09-24; reviewed/updated 2026-10-05. Attacker-controlled format strings with unbounded precision can cause denial of service.
- **Package:** `sprintf-js@1.0.3`; affected `<=1.1.3`, no patched npm release. Latest 1.1.3 remains affected and is not a remediation.
- **Created on:** 2026-10-06.
- **Provenance:** mobile production-declared React Native/Babel/Jest tooling: `react-native@0.83.0 → babel-jest@29.7.0 → babel-plugin-istanbul@6.1.1 → @istanbuljs/load-nyc-config@1.1.0 → js-yaml@3.15.2 → argparse@1.0.10 → sprintf-js@1.0.3`, also via `@jest/transform@29.7.0`. Expo, Expo Router and native peer packages introduce additional paths. All 344 simple paths, 97 ancestor edges and 18 cycles are recorded in the investigation below and its complete diagnostic manifests; no direct Pachi product import was found.
- **Runtime/build exposure:** no target package in inspected mobile web/Android/iOS export source maps or web/admin deployment traces. API/web/admin/worker production graphs have no sprintf path. NYC loads local YAML through the library, whereas js-yaml's CLI loads Argparse's formatter. No attacker-controlled vulnerable format-string path was established. These observations reduce demonstrated reachability; they do not prove universal non-exploitability or make the package harmless.
- **Reason:** no narrow released compatible remediation was established. Argparse 2.0.0 and 2.0.1 remove sprintf but break the tested legacy js-yaml CLI `--version` behavior; both overrides were rejected. Argparse v3 removes required legacy APIs. YAML major migration changes accepted schema; evaluated newer Babel/Jest still use the same NYC loader, and compatible React Native 0.83 patches retain the chain. Broader stack migration requires separate review. Full release/compatibility evidence remains in the historical investigation below.
- **Compensating controls:** the exact approved GHSA set at severity `low`, all other findings/registry failures blocking. Checks runs in a fresh GitHub-hosted `ubuntu-latest` VM with `contents: read` and only synthetic TEST database settings; the workflow references no production application secrets. Repository-controlled build/help/configuration inputs remain required; no feature may introduce user-controlled format strings into this chain. The hosted VM's finite CPU/memory and GitHub's default 360-minute job timeout bound CI resources ([runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [timeout reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes)); these are platform bounds, not a precision-parser fix. Local candidate validation uses the isolated worktree, synthetic TEST settings, no copied production environment files, and command timeouts. Any new externally controlled formatting path invalidates this acceptance immediately. Published sprintf/Argparse/js-yaml/Jest/Babel/React Native fixes or dependency removals remain immediate removal triggers; this decision creates no recurring investigation or automatic extension.
- **Owner:** Project owner / repository maintainer.
- **Reviewed on:** 2026-10-14.
- **Owner decision on:** 2026-10-14.
- **Owner decision:** ACCEPTED ONCE for development/CI only; no automatic extension or production deployment approval.
- **Risk history:** Created 2026-10-06 following Case B, originally due 2026-10-13. The owner approved the October 11 three-day extension to 2026-10-16, integrated in PR #43; no remediation or deployment approval. On 2026-10-14, the owner separately accepted the same unresolved risk once for development/CI through the November 13 boundary.
- **Review by:** 2026-11-13.
- **Removal trigger:** immediately remove/reassess this exception on a compatible patched sprintf release; a compatible released parent or React Native/Jest/Babel/js-yaml path removing the vulnerable package without breaking accepted behavior; any direct Pachi product import; any attacker-controlled format string reaching the installed chain; a shipped runtime path with externally controllable input; or materially higher severity/exploitation evidence. Do not wait for the review date if any trigger occurs. The deadline day itself is blocking.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES, development/CI only; not production/pilot readiness.

## Retired dependency-audit exceptions

- **Retired on:** 2026-10-28.
- **Patched package:** `node-forge@1.4.1`.

The released October 27 Forge patch fixes CVE-2026-85393. Both current Expo CLI
and certificate-signing consumers resolve the authentic 1.4.1 package within their
existing `^1.3.3` range. Registry integrity/signatures, the upstream RSA implementation,
valid signing/certificate operations and rejection of the bounded upstream forged
signature fixture were verified. The former GHSA is no longer ignored. Retirement
removes risk acceptance; it does not grant production or broader G3 approval.

The following record is the unchanged historical October 14 acceptance, including
its then-current no-patch assessment, original decisions and dates. Its unfixed and
temporarily accepted labels describe that historical state, not the current graph.

- **Advisory:** `GHSA-86w9-cpqp-85rv`.
- **CVE:** `CVE-2026-85393`; HIGH severity (CVSS 8.7).
- **Package:** `node-forge@1.4.0`; no patched release is currently published. Upstream fix PR [digitalbazaar/forge#1152](https://github.com/digitalbazaar/forge/pull/1152) is open and targets the unreleased 1.4.1 changelog entry.
- **Created on:** 2026-10-02.
- **Provenance:** lock graph places the package in `apps/mobile` through `expo@55.0.0` → `@expo/cli@55.0.11` → `node-forge` and `@expo/code-signing-certificates@0.0.6` → `node-forge`; Expo Router adds equivalent paths. It is not a direct Pachi dependency.
- **Runtime/build exposure:** the production dependency listing for `@pachi/mobile` includes this Expo tooling/signing path. The API, marketplace web, admin and worker production dependency graphs do not include `node-forge`. No direct Pachi source import was found. The mobile bundle's reachability of this code has not been established; the dependency is not claimed harmless.
- **Reason:** the registry's patched-version status is unknown, npm's latest release remains 1.4.0, and the current compatible Expo SDK 55 CLI/signing dependency ranges do not remove the vulnerable release.
- **Compensating controls:** audit severity stays `low`; the guard enforces exactly the three approved GHSAs and requires a separate complete record for each; every other advisory continues to fail the dependency check. No unaudited fork or unreleased node-forge commit is used.
- **Owner:** Project owner / repository maintainer.
- **Reviewed on:** 2026-10-14.
- **Owner decision on:** 2026-10-14.
- **Owner decision:** ACCEPTED ONCE for development/CI only; no automatic extension or production deployment approval.
- **Risk history:** Created 2026-10-02 with review due 2026-10-16; vulnerability remained unresolved. On 2026-10-14, the owner separately accepted the same unresolved risk once for development/CI through the November 13 boundary.
- **Review by:** 2026-11-13.
- **Removal trigger:** remove the exception when a patched node-forge release becomes available through compatible Expo tooling, or when a compatible Expo update removes the vulnerable dependency. Re-run the unfiltered audit and the full CI pipeline after removal.
- **Vulnerability fixed:** NO.
- **Temporarily accepted:** YES.

## Gate summary

| Gate | Required result | Current evidence state |
|---|---|---|
| G0 Specification | Reconciled V2.1 baseline, explicit authority and decisions, stable requirements, no competing canonical versions. | COMPLETE — canonical package is present and committed; the factual implementation-status wording has been reconciled. |
| G1 Architecture foundation | Running scaffold plus implemented environment/migration/CI/auth/security/logging/backup foundations. | COMPLETE — foundation evidence and real mapped-ungranted staff denial verified. See [acceptance evidence and separate operational limitations](../engineering/current-state.md#real-mapped-ungranted-acceptance-passed-g1-evidence-complete--2026-09-28). |
| G2 Vertical slice | Verified provider → property/listing/offering/media → moderation/publication → discovery → inquiry/response, with server authorization and analytics. | COMPLETE — recorded synthetic/local individual-provider acceptance, merged PR #27 and exact merge-main Checks 37305379014. See [closure evidence and limitations](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05). |
| G3 Marketplace alpha | Full core mobile/web/staff, organization, viewing/review, offline, reporting/appeal, notification and analytics behavior. | NOT RUN. |
| G4 Private pilot | Real-data/vendor/operations gates, seed inventory, scorecard and rehearsal in Cameroon launch regions. | NOT RUN. |
| G5 Public MVP | Pilot scorecard and reliability/safety requirements pass; release/rollback verified. | NOT RUN. |
| G6 Regional expansion | Sustained supply, moderation capacity and local readiness for each new region. | NOT RUN. |

## G0 — Documentation and repository

- [x] Replace canonical docs with this package, including roles-and-permissions and all six ADRs; inspect diff and commit a documentation-only change. Evidence: canonical package on main and the [mainline integration record](../engineering/current-state.md#integration-completed-on-main--2026-09-28).
- [x] Remove/mark superseded parallel authorities; preserve archives with explicit noncanonical status. Evidence: [authority and archive policy](../README.md#authority-and-conflict-rule).
- [x] Validate links, decision defaults, entity/lifecycle names and requirement coverage; retain the reconciliation record. Evidence: [documentation migration record](../archive/documentation-migration-record.md) and this 2026-09-30 status reconciliation.
- [x] Confirm repository and handoff describe the implemented foundation and G1 accurately without claiming production readiness. Evidence: [current engineering handoff](../engineering/current-state.md).

## G1 — Foundation

- [x] Clean clone installs with pinned runtime/package versions and frozen lockfile; API/mobile/web/admin and worker skeleton start/build as applicable. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] Local PostgreSQL/PostGIS, migration framework, synthetic seeds and environment validation work without production credentials. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] CI checks type/lint/build, relevant tests, secrets/dependencies, migration and contract consistency. Evidence: [exact 26f0b4b CI and check design](../engineering/current-state.md#current-g1-closure-status).
- [x] Health/readiness, safe error envelope, request IDs and redacted logs are implemented. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] Threat/data boundaries cover identity, private evidence, organization scope, location privacy, client trust and external adapters. Evidence: [bounded implementation review and findings](../engineering/current-state.md#threat-boundary-review-of-implemented-foundation).
- [x] Auth session registry, phone participation gate, staff MFA/step-up design and permission test harness demonstrated in isolated environments; production mock-auth rejection tested. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).
- [x] Current membership/account/session revocation denial tested; database constraints and stale-write/idempotency conventions demonstrated. Evidence: [current G1 work](../engineering/current-state.md#g1-closure-work-in-progress--2026-09-28), actual module/guard HTTP harness with isolated memberships; no organization product endpoint is exposed.
- [x] Backup/restore mechanism demonstrated in nonproduction; environment/secret separation and future deployed restore procedure recorded. Evidence: [2026-09-27 reconciliation](../engineering/current-state.md#g1-evidence-reconciliation--2026-09-27).

## G2 — Working marketplace slice

- [x] Individual provider required verification workflow and explicit current property declaration operate with protected synthetic evidence. Evidence: PR #27 fixed-sample intake, encrypted persistence, scoped staff review/current VERIFIED claim and DECLARED property in the [recorded TEST acceptance](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05); real intake remains E01-gated.
- [x] Property, Listing, Offering/OfferingVersion and revision constraints are implemented; wrong-purpose terms and mismatched authority denied. Evidence: PR #27 real commands/current CLEAR authority and wrong-purpose denial, plus preserved mismatch/stale-version [component evidence](../engineering/current-state.md#canonical-status-reconciliation-and-g2-evidence-matrix--2026-09-30).
- [x] Image upload/quarantine/processing/approval works; failed/private assets cannot be public. Evidence: PR #27 local pipeline, READY then separate APPROVED decision, anonymous denial before publication, plus preserved failure/privacy [component evidence](../engineering/current-state.md#canonical-status-reconciliation-and-g2-evidence-matrix--2026-09-30).
- [x] Staff reviews exact listing revision; publication predicate enforced for API/search/detail. Evidence: PR #27 exact submitted snapshot, scoped signed staff publication/replay and anonymous search/detail/media in the [recorded acceptance](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05).
- [x] Seeker discovers, creates/reuses inquiry/Conversation, messages, receives provider response; cross-user/organization access denied. Evidence: PR #27 coherent inquiry/message/reply/replay and unrelated/historical-participant denials; organization fail-closed denial remains preserved [component evidence](../engineering/current-state.md#canonical-status-reconciliation-and-g2-evidence-matrix--2026-09-30), not positive organization messaging acceptance.
- [x] Domain events and analytics distinguish publication/contact/first response; retries do not duplicate business effects. Evidence: PR #27 exact five events/five JobReceipts, second drain 0/0, unchanged source flags, TEST privacy and mature response metric in the [recorded acceptance](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05).
- [x] Recorded end-to-end demonstration and meaningful policy/integration test evidence pass. Evidence: [PR #27](https://github.com/david-developer/pachi/pull/27) merged unchanged; [exact merge-main Checks 37305379014](https://github.com/david-developer/pachi/actions/runs/37305379014) PASS, all 27 stages, DB44/API13/web21/admin7 including the coherent G2 journey. See [closure and external limits](../engineering/current-state.md#g2-vertical-slice-complete--2026-10-05).

## G3 — Core marketplace alpha

- [ ] Owner/agent/manager distinctions; five organization roles, assignments, owner transfer/recovery and final-owner race protection.
- [ ] RENT/SALE/SHORT_LET offerings and versions, three listing state axes, market availability, freshness/expiry and region publishing controls.
- [ ] English/French UI architecture and launch text, accessible navigation/forms/errors, mobile low-bandwidth states and responsive marketplace/staff web.
- [ ] Native saved/offline listings with bounded cache, last-sync/staleness labels, logout purge and honest unsent actions.
- [ ] Core text messaging/native call intent, block/report, assignment revocation and safe history when listing/provider disappears.
- [ ] Viewing request/expiry/scheduling/rescheduling/cancellation, timezones, private instructions and attendance claims/disputes.
- [ ] Bilateral first-completed-viewing eligibility; org-principal uniqueness; 7-day default double-blind reveal; edit/withdraw rules and hidden-review aggregate repair.
- [ ] Provider/business/authority verification, risk-based authority requirement, expiry/revocation, appeals and evidence privacy/retention controls.
- [ ] Report/case queues, scoped moderation, immutable actions, sole-operator reconsideration/conflict policy and meaningful audit evidence.
- [ ] Durable inbox, email/SMS/push adapters, preferences/quiet hours/localization, receipt distinctions, retries/DLQ and spend caps.
- [ ] Client/domain analytics schema, dedupe, privacy exclusions, numerator/denominator definitions and operational queue dashboards.
- [ ] No open critical authorization, privacy, data-loss or security defect in core flows.

## External evidence gates

| ID | Evidence required | Responsibility / deadline | Until passed |
|---|---|---|---|
| E01 | Cameroon-appropriate evidence categories, privacy notice, retention/deletion/backup/hold policy and applicant disclosure reviewed; actual approved durations configured. | Project owner in privacy/trust responsibility; before real evidence collection, no later than G4. | Synthetic documents only; real-evidence intake disabled. |
| E02 | Real Cameroon SMS delivery/latency/redemption tests, sender/consent requirements, English/French segmentation, limits and cost; SES DNS/production quota/bounce/complaint and push receipt checks. | Engineering/operations; before real delivery, G4. | Test sinks or allowlisted consenting recipients only. |
| E03 | Hosting/account security, current cost estimate and budget, Cameroon network/region measurements, DNS/TLS, least-privilege deployment and environment separation. | Engineering/operations; before live provisioning/pilot, G4. | Local/synthetic staging work only within approved spend. |
| E04 | Deployed restore and complete regional procedure including identity/media/keys/deletion tombstones; actual RPO/RTO measured and recovery access demonstrated. | Operations; G4 and repeat after relevant changes. | No live pilot/public production. |
| E05 | Metric quality, seed coverage, numeric pilot targets/sample sizes and support/moderation coverage recorded before recruiting pilot. | Product/operations; G4. | No public release based on unmeasured success claims. |
| E06 | Map/geocoder coverage, terms/storage/attribution, privacy, key restrictions and cost. | Engineering/product; before enabling map features. | List/manual structured-location features continue; map feature disabled. |
| E07 | Cognito/social login/linking/revocation, phone changes, staff/owner step-up, recovery, developer credentials and outages demonstrated end to end. | Engineering/security; before real accounts, G4. | Isolated test identities only. |

These are evidence tasks, not permission to substitute a new stack or omit product requirements. Coding agents can implement the settled contracts while the relevant real-data feature remains disabled.

## G4 — Private Cameroon pilot

- [ ] G1–G3 and E01–E05/E07 passed; E06 only if maps are enabled.
- [ ] Southwest and Littoral launch controls work; at least 20 publishable fresh listings and 5 verified responsible providers per enabled pilot region. Other regions remain preregistration-only.
- [ ] Representative mobile/network testing, actual notification paths and accessible English/French user guidance completed.
- [ ] Terms/privacy/contact/appeal routes, verification queue, safety escalation and sole-operator coverage are operating; volume cap set to match capacity.
- [ ] Production-like staging deployment, rollback, migration recovery, backup restore and incident rehearsal recorded.
- [ ] Numeric scorecard below frozen before recruitment; any change recorded with reason before evaluating outcomes.
- [ ] Pilot accounts consent to participation; seed inventory and evidence are authorized, not fabricated as real supply.

## Pilot scorecard and G5

Initial targets below are reconciliation defaults to make the gate executable, not claimed research results. Validate instrument definitions during alpha, then confirm or explicitly amend targets **before** the pilot. Never lower thresholds retroactively simply to declare a pass.

Measurement window: at least 14 consecutive days, with at least 100 successful search sessions, 30 distinct eligible contact interactions and 10 scheduled viewings reaching appointment time. Report aggregate and by region/purpose; small segments are labeled insufficient evidence rather than hidden. A failed technical search is not a zero-inventory result. A repeated retry does not create a new event/interaction.

| Metric / condition | Initial pass target / definition |
|---|---|
| Useful search rate | ≥50% of successful search sessions receive ≥1 eligible result followed by listing/result view within 30 minutes. Report zero-results and technical failures separately. |
| Provider response | ≥80% of first eligible seeker contacts receive first provider reply within 24 hours. Exclude self/test/spam contacts with reason-coded filtering. |
| Viewing acceptance | ≥60% of valid viewing requests whose response deadline passed were accepted before expiry; report cancellations/declines separately. |
| Viewing completion | ≥60% of scheduled viewings whose appointment ended become validated COMPLETED after the 48-hour response window; pending/disputed included as not-yet-completed. |
| Listing freshness | 100% of discoverable listings satisfy expiry/required verification checks; report number/share of intended active listings that expired separately to measure supply loss. |
| Safety | Zero unresolved critical security/privacy/data-loss/authorization findings; no public private evidence or held review contents; incident/appeal paths demonstrated. |
| Reliability | Core availability target 99.5%, indexed-read p95 <800 ms at documented pilot load, crash-free mobile sessions ≥99%; report sample size and planned downtime separately. |
| Recovery | In-region RPO ≤1 hour/RTO ≤8 hours; regional RPO ≤24 hours/RTO ≤24 hours in rehearsed tests including identity and media. |
| Coverage | No unowned critical cases; queue-age alerts and response capacity demonstrated; no false promise of independent reviewers. |

If sample sizes are insufficient, extend the pilot. A 14-day pilot availability measure is interim evidence, not a claim of an observed complete month; keep the monthly target monitored after launch. G5 also requires full core scope, confirmed configuration/retention/vendor evidence, no critical defect and the [launch-day checklist](launch-day-runbook.md). Passing infrastructure checks alone is insufficient.

## G6 — Expansion

- [ ] Launch regions have sustained supply quality, provider responsiveness, safety queue capacity and reliability.
- [ ] Next region has authorized seed providers/inventory, location data, support/moderation coverage and tested delivery/network behavior.
- [ ] Region activation is a permissioned audited configuration change; no client-only enablement.

## Evidence record template

| Gate/item | Commit/release | Environment/date | Evidence link | Result | Responsibility | Retest trigger |
|---|---|---|---|---|---|---|
| NOT RUN | — | — | — | Evidence not recorded for this item | Project owner | Complete affected work |

Add real records as work is completed. Do not replace NOT RUN with PASS because a document was edited.

## Source-map remediation candidate — 2026-10-06

`source-map-js` [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), `CVE-2026-93749`, is remediated in this candidate by the released **1.2.1 → 1.2.2** lockfile update within PostCSS 8.5.23's existing `^1.2.1` range. No manifest addition, new override or advisory exception is needed. The web/admin Next → PostCSS and mobile Expo/Metro-config → PostCSS provenance and observed build/runtime exposure are recorded in the investigation below. The candidate lock and active root store contain only patched 1.2.2; the new bounded regression covers indexed offset validation and reconstruction beyond input length. Fresh configured/unfiltered/production audits, migration/integration/G2, browser and export evidence are recorded in the current [engineering handoff](../engineering/current-state.md). Complete local validation passed: policy27/startup33/workspace units44, clean TEST migrations/hashes29, DB69/API22/unchanged G2, Chromium web33/admin7, frozen install/secrets/contracts/lint/typecheck/uncached build and all mobile exports. Exact final-head push/PR Checks remain required before candidate handoff; see the engineering entry for immutable identities and results.

## October dependency triage — 2026-10-06; policy decision pending

**Historical Case B investigation, preserved:** the following report predates the user's separate source-map-fix/third-exception authorization. Its former stopping instruction and pending-policy status are superseded by the current acceptance records above and engineering handoff; its provenance, compatibility failures and exposure limits remain evidence.

This is the separately authorized security investigation from main `12394700b08a2d723f3b12a458f3acba2ffbf5e6`, in `chore/security-advisories-2026-10-06`. It is **Case B**, an uncommitted local source-map fix with an unresolved blocking sprintf finding. It grants no new acceptance. The two exception records above, their order, the `low` threshold and their **2026-10-16** deadline remain unchanged. The preserved G3-B worktree is separate; G3 remains NOT RUN. The [engineering handoff](../engineering/current-state.md#october-security-maintenance--case-b-policy-decision-required--2026-10-06) records preservation and validation.

| New advisory | Reviewed upstream status, checked 2026-10-06 | Local result |
|---|---|---|
| HIGH `source-map-js@1.2.1`, [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), `CVE-2026-93749` | Published 2026-09-18; reviewed/updated 2026-10-05. Affected `>=1.0.0 <1.2.2`; patched **1.2.2**, released 2026-09-30. Indexed source-map section offsets can block the event loop. | Prepared natural lockfile resolution **1.2.1 → 1.2.2** under PostCSS's existing `^1.2.1` range. No manifest, override or parent upgrade. No vulnerable copy in the candidate lock or active root virtual store. |
| MODERATE `sprintf-js@1.0.3`, [GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), `CVE-2026-97058` | Published 2026-09-24; reviewed/updated 2026-10-05. Affected `<=1.1.3`; **no patched version**. Unbounded format precision can cause denial of service. | Unresolved. Registry latest 1.1.3 is still affected. Evaluated removal routes below do not provide a narrowly compatible released replacement. No new exception. |

### Exact provenance and observed exposure

Baseline multi-document pnpm lock inspection and recursive/per-workspace production listings establish the following. Packages are transitive installed dependencies; production classification and shipped application reachability are assessed separately.

| Workspace production graph | source-map-js | sprintf-js |
|---|---|---|
| API | Absent | Absent |
| Marketplace web | Present via Next/PostCSS | Absent |
| Admin | Present via Next/PostCSS | Absent |
| Worker | Absent | Absent |
| Mobile | Present via Expo/Metro-config/PostCSS | Present via React Native/Babel/Jest/NYC |

- **Source-map parent:** the only direct parent is `postcss@8.5.23`, declaring `source-map-js: ^1.2.1`. Web and admin each introduce `next@16.3.6 → postcss@8.5.23 → source-map-js@1.2.1`. Mobile introduces `expo@55.0.0 → @expo/metro-config@55.0.8 → postcss@8.5.23 → source-map-js@1.2.1`, and `expo@55.0.0 → @expo/cli@55.0.11 → @expo/metro-config@55.0.8 → postcss@8.5.23 → source-map-js@1.2.1`. Expo Router 6.0.0 supplies additional paths via Expo itself, `@expo/metro-runtime@6.1.1`, `expo-constants@18.0.14`, and `expo-linking@8.0.12 → expo-constants@18.0.14`. All **12 simple workspace paths** are ordinary dependency edges; no development-only root introduces this package. The complete ancestor graph also contains peer/optional cycles, recorded rather than expanded indefinitely.
- **Sprintf parent:** the only direct parent is `argparse@1.0.10`, declaring `sprintf-js: ~1.0.2`. Its sole parent is `js-yaml@3.15.2`, declaring `argparse: ^1.0.7`. The common full chain is `react-native@0.83.0 → babel-jest@29.7.0 → babel-plugin-istanbul@6.1.1 → @istanbuljs/load-nyc-config@1.1.0 → js-yaml@3.15.2 → argparse@1.0.10 → sprintf-js@1.0.3`; Babel Jest also reaches the plugin via `@jest/transform@29.7.0`. The five introducing mobile production roots are `react-native@0.83.0`, `expo@55.0.0`, `expo-router@6.0.0`, `react-native-safe-area-context@5.6.0`, and `react-native-screens@4.16.0`. There are **344 complete simple paths**, including installed peer variants and some optional edges; the direct React Native path is nonoptional. No independent development-only root introduces it. This is build/test tooling carried by production-declared packages, not evidence that it executes in the mobile app.
- **Complete graph evidence:** `/tmp/pachi-security-lock-provenance.json` records all parent edges, paths, dependency kinds and cycles (source-map: 48 edges/17 cycles; sprintf: 97 edges/18 cycles). Exact peer-resolved path manifests are `/tmp/pachi-security-source-map-js-all-paths.txt` (SHA256 `49235a8d8876a90479529252f1ac1d78c251c59acd3181c7ad8c86507a62b08a`) and `/tmp/pachi-security-sprintf-js-all-paths.txt` (SHA256 `bba2c4d84b072f17896385ed535fa81702d06b3ff49c39e4552e577c8f36de63`). The diagnostic generator `/tmp/pachi-security-lock-provenance.cjs` reads both YAML documents and enumerates simple paths while recording cycles separately. `pnpm audit` caps representative paths at 100; it is not the exhaustive manifest. Per-workspace listings are `/tmp/pachi-security-prod-{api,web,admin,worker,mobile}.json`.
- **Shipped evidence:** fresh mobile web/Android/iOS export source maps contain 752/958/962 sources, respectively; none identifies `source-map-js`, `sprintf-js`, `argparse`, `js-yaml`, `@istanbuljs/load-nyc-config`, or `babel-jest`. Web/admin Next output-file tracing covers 43/24 traces with no external files from either vulnerable package or PostCSS. Emitted JavaScript scans (214/236 files) find neither package identifier; this text scan cannot exclude arbitrary vendored/minified implementations. Evidence: `/tmp/pachi-security-mobile-bundle-evidence.json`, `/tmp/pachi-security-next-trace-evidence.json`; diagnostic maps remain under the isolated worktree's ignored `.local-dev/security-bundle-evidence/mobile`.
- **Input reachability:** no direct product source import or formatting call was found for either package. PostCSS's `previous-map.js` can parse inline/previous source maps, but inspected Pachi product paths do not accept attacker-supplied CSS/indexed maps; current use is repository-controlled build input. For sprintf, Argparse's help formatter consumes configured usage/help templates. NYC uses js-yaml's library `load()` on local coverage configuration; js-yaml's library does not import Argparse, whereas its CLI does. No path from marketplace-controlled input to a sprintf format/precision string was established. These observations reduce demonstrated runtime exposure; they do **not** prove universal non-exploitability or remediate the package.

### Released removal routes evaluated for sprintf-js

| Route/version evaluated | Result and compatibility cost |
|---|---|
| `sprintf-js@1.1.3` | Remains affected; upgrading is not a fix. |
| Current/latest v1 `argparse@1.0.10`, compatible js-yaml v3 `3.15.2`, `@istanbuljs/load-nyc-config@1.1.0` | Already the latest compatible releases; all retain the vulnerable chain. NYC loader has no newer stable published version. |
| Scoped `js-yaml@3.15.2>argparse` override to released **2.0.1**, then **2.0.0** | Both dependency-free v2 releases remove sprintf and retain many v1 aliases, but actual js-yaml CLI tests expose a compatibility regression: `--version` exits 0 with **empty output**, versus baseline `3.15.2`. Six ordinary CLI conversion modes/help passed before this failing assertion. Published v2 code passes `this.version` without storing the legacy constructor version value. Both trials were rejected and the override removed. A passing audit on the trial does not authorize an incompatible candidate. |
| `argparse@3.0.2` | Dependency-free, but [upstream migration documentation](https://github.com/nodeca/argparse/blob/master/doc/migrate_v2_to_v3.md) removes v1 aliases/options used by the exact js-yaml v3 CLI (`addArgument`, `parseArgs`, `addHelp`, action aliases and constructor version). Incompatible without modifying upstream code. |
| Scoped js-yaml override to **4.3.2** or newer **5.4.3** | Removes sprintf via Argparse v2 and a migrated CLI, but lies outside loader `^3.13.1`. A concrete v3 library compatibility fixture (`!!js/regexp`) is accepted by installed 3.15.2 and rejected by 4.3.2. This is a YAML schema/major migration requiring broader compatibility review, not a demonstrated compatible patch in this task. v5 is likewise outside the declared range. |
| `babel-plugin-istanbul@7.0.1` / `8.0.2`; `babel-jest@30.5.2` | Released newer majors still depend on NYC loader `^1.0.0`, resolving its same js-yaml v3 chain. Larger tooling changes would not remove the package. |
| `react-native@0.83.10` | Latest released compatible patch still declares Babel Jest `^29.7.0`; retains the chain. |
| `react-native@0.87.1` | Its published dependency manifest removes Babel Jest, but migrating RN/Expo/navigation/native peers is outside this bounded task and has not been validated as compatible with Expo 55. |
| Remove direct dependency / use unreleased NYC loader changes | Pachi has no obsolete direct sprintf/Argparse/NYC dependency to remove; React Native is required. Unpublished commits, forks, vendoring and node_modules patches were excluded as instructed. |

Trial failures are preserved in `/tmp/pachi-security-compatibility-tests.log` (2.0.1) and `/tmp/pachi-security-argparse-200-compatibility.log` (2.0.0). Baseline actual legacy CLI/library/NYC-extends checks pass in `/tmp/pachi-security-cli-baseline-compatibility.log`. Diagnostic packages under ignored `.local-dev` are not remediation dependencies and their separate npm audit output is not the repository's audit.

### Risk and proposed policy decision

The remaining finding concerns availability. A dependency graph path is proven; remote product input reaching the vulnerable formatter is not established, and the inspected exports/traces do not ship the identified package. Builds still install it, so repository/configuration-controlled tooling input and future integrations remain relevant. No general safety claim follows from absence in these artifacts.

Maintain the existing audit failure until an independently reviewed decision. If temporary acceptance is chosen, propose **Project owner / repository maintainer** as owner and **2026-10-13** as a separate seven-day review deadline, with immediate removal on a patched sprintf release or a compatible upstream removal. Recheck official advisory/npm releases, inspect future format/template integrations, reject untrusted format strings, and keep PR/build jobs isolated from production secrets with explicit resource/time limits where feasible. Current Checks already uses `contents: read`; additional controls are recommendations, not claimed implemented safeguards. Any acceptance needs separate authorization and its own exact-advisory record/checker change; this section does not approve it. The existing two HIGH deadlines stay **2026-10-16**.

Fresh candidate configured audit **FAILS** on sprintf; unfiltered and production-only audits each contain exactly `GHSA-86w9-cpqp-85rv` (HIGH), `GHSA-vfj7-8cjw-p6xm` (HIGH), and `GHSA-hp3w-g68c-fv3c` (MODERATE), with no source-map or unrelated new advisory. Local source-map tests, frozen install, contracts, secrets, startup, lint/typecheck, uncached full build and all mobile exports passed. The full Case A database/browser/CI gate was not run because Case A was not achieved. No commit, push, PR, merge or deployment was created.

**SECURITY POLICY DECISION REQUIRED — sprintf-js has no released remediation**


### October 6 Sharp and shell-quote remediation candidate

This separate maintenance candidate starts from verified main `10b7bef14e916fe90d05c988d6d3b47311e5cb23`. Baseline frozen installation with Node 24.21.0 / pnpm 12.0.0 reproduced exactly five findings in fresh unfiltered and production audits: the three existing temporary findings plus the following two. Both new records were published/reviewed in GitHub's advisory database on **2026-10-06**, after the earlier exact-main gate. Upstream publication dates were September 30 (Sharp) and September 29 (shell-quote). This assessment does not authorize production, deployment, a merge, or G3-B resumption; **G3 remains NOT RUN**.

| Advisory | Baseline / affected range | Released remediation | Exposure and compatibility |
| --- | --- | --- | --- |
| [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), HIGH | Sharp 0.35.4; affected <0.35.5 | Exact `packages/media/package.json` pin **0.35.5**, matching `@img/sharp-*` 0.35.5 / libvips package 1.3.4 resolutions | Direct `@pachi/media` runtime dependency, inherited by the worker; web/admin Next 16.3.6 also permits the same patch via optional `sharp:^0.35.4`. Installed native versions are Sharp 0.35.5 / libvips 8.18.7 / librsvg 2.63.2. |
| [GHSA-pqg4-j6r4-53mv](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), CRITICAL; **CVE-2026-102422** | shell-quote 1.10.0; affected >=1.8.4 <1.11.0 | **1.11.0 lockfile-only** resolution; no parent upgrade or override | Only immediate parent is `react-devtools-core@6.1.5`, whose `shell-quote:^1.6.1` already permits 1.11.0, through React Native 0.83.0 and the mobile roots enumerated below. |

**Sharp runtime boundary:** `packages/media/src/index.ts` directly imports Sharp. `processListingImage()` checks the original 15 MiB limit and JPEG/PNG/WebP signatures before scanning and decoding externally supplied listing bytes, then enforces the 40 MP decoded ceiling, re-encodes bounded WebP derivatives, strips metadata and records the original SHA256. `processOneMediaJob()` verifies stored MIME/size/checksum before that pipeline. `apps/worker/src/media-worker.ts` invokes it via `@pachi/media`. SVG is rejected before normal processing. The advisory concerns vulnerable upstream librsvg behavior with possible RCE under particular glibc Linux runtime conditions; its disclosed SVG exploit is not demonstrated through this intake. Direct untrusted-image processing is still real exposure, and that distinction does not justify retaining the vulnerable dependency. No SVG workaround replaces the patch, no accepted formats or safety/approval gates change, and media READY remains separate from approval.

**Complete shell-quote classification:** every introducing path below starts at **apps/mobile `dependencies`**, rather than a workspace devDependency, and ends at the same React Native → React DevTools → shell-quote copy. The five direct roots are Expo 55.0.0, Expo Router 6.0.0, React Native 0.83.0, safe-area-context 5.6.0 and screens 4.16.0. Intermediate Expo/Metro/log-box/router/navigation/assets nodes are mobile runtime or mobile build/debug tooling according to their role; installation in the production dependency graph is not proof of execution in a shipped release. React Native's `Libraries/Core/setUpReactDevTools.js` loads React DevTools inside `if (__DEV__)`. No current Pachi application/package source directly imports shell-quote or calls its `quote()` API. Inspection of the published DevTools backend/standalone entry points and compiled bundles found no literal external shell-quote require or named `.quote()` call; minification/vendoring limits that negative observation, so it is not a complete reachability proof. Fresh release-mode web/Android/iOS export source maps contain 752/958/962 sources respectively, with no `shell-quote` or `react-devtools-core` source entry. This supports debugger/tooling rather than shipped mobile execution for these exact exports; source-map absence cannot exclude arbitrary vendored code. Evidence is `/tmp/pachi-security-b-mobile-bundle-evidence.json`, with diagnostic maps under ignored `.local-dev/security-b-bundle-evidence/mobile`. No existing Pachi path was demonstrated to send attacker-controlled text through `{ comment }`, a following line terminator and shell execution. Such a combination is the disclosed injection condition; tooling/development classification and transitivity do not make it harmless. The compatible released patch is applied to the entire graph regardless.

**Provenance method:** recursive and filtered production `pnpm why`, plus complete traversal of the baseline lockfile's dependency and optional/peer-expanded snapshot edges, identify one shell-quote version, one immediate parent, 31 ancestor nodes and 86 edges. The audit's 100 displayed paths are capped and are not the completeness proof. Enumerating all simple acyclic paths from every workspace dependency root yields **172 distinct chains**; cyclic peer backedges are retained in the complete graph artifact and skipped only during finite path enumeration. Parenthesized pnpm peer contexts are omitted below solely for readability; all 172 chains remain distinct. Each chain shares the workspace, dependency group, immediate parent, debugger/build classification, direct-import absence and qualified reachability assessment above. The same chains now end in shell-quote 1.11.0. Full peer-qualified graph/path artifacts: `/tmp/pachi-security-b-shell-quote-{provenance-graph,all-acyclic-paths}.json`; recursive baseline/final `why` artifacts are `/tmp/pachi-security-b-{baseline,final}-shell-quote-why.json`.

<details>
<summary>All 172 baseline introducing chains; every terminal version is now 1.11.0</summary>

```text
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> expo-constants@18.0.14 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> expo-linking@8.0.12 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-router@6.0.0 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> expo-constants@18.0.14 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> expo-linking@8.0.12 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> expo-router@6.0.0 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/cli@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/devtools@55.0.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> expo-asset@55.0.20 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> expo-asset@55.0.20 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> expo-file-system@55.0.26 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> expo-modules-core@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo@55.0.0 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/cli@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/devtools@55.0.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> expo-asset@55.0.20 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> expo-asset@55.0.20 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> expo-file-system@55.0.26 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> expo-modules-core@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> expo@55.0.0 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @expo/metro-runtime@6.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/bottom-tabs@7.19.2 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/elements@2.9.43 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> @react-navigation/native@7.4.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> @react-navigation/native-stack@7.19.2 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/cli@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/devtools@55.0.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> expo-asset@55.0.20 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> expo-asset@55.0.20 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> expo-file-system@55.0.26 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> expo-modules-core@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo@55.0.0 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/devtools@55.0.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-asset@55.0.20 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-asset@55.0.20 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-file-system@55.0.26 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-modules-core@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-constants@18.0.14 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> @expo/router-server@55.0.19 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/cli@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/devtools@55.0.2 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/log-box@55.0.7 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/vector-icons@15.1.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-asset@55.0.20 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-asset@55.0.20 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-constants@55.0.17 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-file-system@55.0.26 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-font@55.0.8 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> expo-modules-core@55.0.11 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> expo@55.0.0 -> @expo/dom-webview@55.0.6 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> expo-constants@18.0.14 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> expo-linking@8.0.12 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> expo-router@6.0.0 -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> react-native-safe-area-context@5.6.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> react-native-screens@4.16.0 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
apps/mobile:dependencies -> react-native-screens@4.16.0 -> react-native-is-edge-to-edge@1.3.1 -> react-native@0.83.0 -> react-devtools-core@6.1.5 -> shell-quote@1.10.0
```

</details>

**Narrow mechanism and regression:** the lockfile update changes only the media Sharp importer, Sharp/platform/libvips package records, Next's optional Sharp edge and React DevTools' shell-quote edge. No unrelated package, parent, workspace override, product source, migration or G3-B file changes. The transitive update selector initially selected 1.12.0; before any commit, its three lockfile references and integrity were corrected to the published dependency-free 1.11.0 registry metadata. Frozen installation and an exact installed-version assertion verify the chosen release; all earlier trial validation was superseded by a complete rerun. The existing bounded compatibility test is extended with three cases: all resolved Sharp/platform and shell-quote versions plus retained source-map-js 1.2.2/exact audit policy; rejection of comment-following LF/CR/U+2028/U+2029 without shell execution, with safe parse/quote round trips; and actual JPEG/PNG/WebP processing, metadata removal, all four bounded variants, SHA256 and checksum-denial-before-effects. Existing media limit/invalid-format/scanner and source-map regressions remain unchanged. A test-only unsupported Sharp package-manifest subpath inspection was corrected to actual `sharp.versions.sharp`; application behavior did not change.

**Final audit boundary:** configured audit passes at unchanged **low**. Fresh unfiltered and production audits each contain exactly the existing three unresolved temporary findings: `GHSA-86w9-cpqp-85rv` node-forge HIGH and `GHSA-vfj7-8cjw-p6xm` braces HIGH, review **2026-10-16**, plus `GHSA-hp3w-g68c-fv3c` sprintf-js MODERATE, review **2026-10-13**. Their raw audit exits remain nonzero; none is remediated or extended. No Sharp, shell-quote or source-map advisory remains. The ordered exception set, policy checker, deadlines and removal triggers are unchanged. Full local and exact-head CI evidence is recorded in the single [engineering handoff](../engineering/current-state.md), including any still-pending evidence at a checkpoint.
