# Reviewed dependency patches

These pnpm patches preserve the installed parent versions. The lockfile pins their
hashes; `pnpm-workspace.yaml` records each dependency edge removed or updated.
Removing an edge is valid only together with its source backport and regressions.
No package version or advisory metadata is falsified.

| Patch | Upstream source | Adaptation |
| --- | --- | --- |
| `@expo/config@12.0.14` and `@expo/config@55.0.21` | [Expo #52602](https://github.com/expo/expo/pull/52602), commit `1e2f968cc38fb9535017e303d675bf14bab3231f` | Complete `mergeConfig.ts` compiled with existing TypeScript 5.9.2 to CommonJS/ES2022; replace all three deepmerge call sites in each installed version, protect inherited plugin lookup and null-prototype inputs, apply all four serializer protections. |
| `@expo/fingerprint@0.16.5` | [Expo #53091](https://github.com/expo/expo/pull/53091), commit `3262acd70f4614edf6c6a23ef7927802bf6bc172` | Backport filesystem `.gitignore` discovery and deterministic parent-first sorting; remove the only glob import. Retain minimatch 10 semantics; its two exact findings have a separately documented, expiring development/CI acceptance. |
| `query-string@7.1.3` | [Original query-string consumer](https://github.com/sindresorhus/query-string/blob/v7.1.3/index.js) and authenticated decode-uri-component 0.5.1 | Adapt only callable/default export selection for CommonJS/ESM interoperability. No decoding algorithm change. |

The installed config versions predate upstream's separate updates-array deduping
behavior. Their existing array concatenation semantics remain unchanged; the new
merger includes upstream's optional array-merger support without introducing new
call sites. Unrelated SDK58/platform/import changes are not backported.

Modified emitted files drop their stale source-map reference. Original map payloads
are unchanged package contents and are not executable dependency paths. The new
merger source is traceable to the immutable upstream commit above.

Scoped glob 14.0.6 resolutions follow Expo's SDK55 branch adoption of glob14 and
[the supported-line upstream change](https://github.com/expo/expo/pull/52819).
Fingerprint uses the removal backport instead of a glob major override. The direct
fingerprint minimatch10 consumer remains unchanged because minimatch11 changes
valid matching behavior. Fingerprint uses pattern/negate/match, not makeRe. Its
two exact advisories are unfixed and accepted only under the approved
development/CI policy until2026-11-20T00:00:00Z; production remains blocked.
TypeScript-ESLint 8.44.0 uses only `minimatch(filePath, pattern, { dot: true })`.
Its exact parent edge is separately updated to 11.0.8 after 4,725 filename/pattern
comparisons and actual parser project-service allow/deny checks. The bounded
regression exercises that installed consumer; this is not a global override.

Before removing a patch, require an official compatible parent release containing
the complete change, actual resolution verification, config/plugin/prototype,
glob/cancellation, fingerprint, SDK export and relevant application regressions.
The security tests in `scripts/security-{decode,deepmerge,expo-toolchain,smithy}-*.mjs`
exercise the installed consumers; the engineering handoff identifies current
verification evidence and remaining blockers.
