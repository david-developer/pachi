# Native seeker discovery (G3-I2)

Expo / React Native / Expo Router homepage, public search and listing details.
No account, saved-listing, offline synchronization, contact or provider actions
are implemented in this slice. The server owns publication, freshness,
verification and media eligibility. Public requests omit credentials; only the
existing coarse-location and public reputation projections are displayed.

## Interactive synthetic TEST review

From the repository root, with the pinned Node and pnpm versions installed:

```sh
pnpm install --frozen-lockfile
EXPO_PUBLIC_API_URL=http://localhost:8085/v1 EXPO_PUBLIC_REVIEW_MODE=synthetic-test \
  pnpm --filter @pachi/mobile exec expo export --clear --platform web --output-dir dist-test
PACHI_MOBILE_EXPORT_DIRECTORY=./dist-test pnpm --filter @pachi/mobile preview:test
```

Open <http://localhost:8085>, <http://localhost:8085/listings>, or
<http://localhost:8085/listings/00000000-0000-4000-8000-000000000151>.
Navigate normally; fixtures are served over HTTP without browser interception.
Every screen is labeled TEST and every invented listing title starts with TEST.
This loopback-only server is read-only, has no database or account adapter, and
uses the existing approved synthetic property photographs. Fixture scripts and
photographs are outside the app bundle. Stop this server before browser tests.

## Native development with the actual public API

```sh
EXPO_PUBLIC_API_URL=http://DEVICE_REACHABLE_HOST:3001/v1 \
  pnpm --filter @pachi/mobile start --lan
```

Replace `DEVICE_REACHABLE_HOST` with the development computer's reachable LAN
address. Open the CLI's QR connection using an Expo SDK 55 compatible client or
native development build. A physical device's `localhost` is the device itself.
Keep `EXPO_PUBLIC_REVIEW_MODE` unset for actual development inventory. Expo public
variables are bundled, so they must contain no secrets and require a rebuild
when changed. No localhost default or test-auth configuration is injected.

The live development API can legitimately return no eligible public listings.
Existing private drafts must stay private. Expo web connecting directly to an
API on another origin additionally requires that API's existing CORS policy;
the isolated same-origin TEST review above avoids changing that policy.

## Checks and evidence

```sh
pnpm --filter @pachi/mobile lint
pnpm --filter @pachi/mobile typecheck
pnpm --filter @pachi/mobile test
pnpm --filter @pachi/mobile build
PACHI_MOBILE_EXPORT_DIRECTORY=./dist-test pnpm --filter @pachi/mobile test:browser
```

The browser harness needs the Chromium shell installed through the web
workspace's existing Playwright dependency. It starts and stops its own TEST
server on 8085, opens fresh sessions, and saves screenshots plus its receipt in
`.local-dev/g3i2-native-browser/`. CI runs the same checks. Android/iOS exports
are bundle validation; Expo web browser checks do not establish physical-device,
VoiceOver or TalkBack acceptance. Owner visual approval and G3-wide acceptance
remain separate.
