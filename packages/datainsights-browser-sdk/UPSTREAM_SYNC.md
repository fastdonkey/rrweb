# DataInsights rrweb Upstream Sync Runbook

## Baseline and ownership

- Product branch: `futrue-v1` (name retained as approved).
- Current rrweb source commit embedded in SDK builds: `7cdbadf927a33987235a80295782091522024a9b`.
- Upstream remote: `upstream` (`rrweb-io/rrweb`).
- Product remote: `origin` (`fastdonkey/rrweb`).
- DI-1001 patch level: L0. There are no L1/L2 changes under rrweb core packages; all product code is isolated in `packages/datainsights-browser-sdk` and `openspec/changes/di-1001`.

The SDK consumes public workspace package exports only. Do not import rrweb internal source paths. Every released bundle contains the SDK version, rrweb package version, and exact rrweb source commit.

## Merge-based update procedure

1. Ensure `futrue-v1` is clean and all DI-1001 validation commands pass.
2. Fetch `upstream` and create `sync/upstream-YYYY-MM-DD` from `futrue-v1`.
3. Merge `upstream/main` into the sync branch. Do not rebase or rewrite the published product branch.
4. Resolve conflicts without changing rrweb event semantics. If a core change becomes unavoidable, stop and create a separately approved ADR and patch record before editing core code.
5. Run the SDK, browser recording/replay, and affected upstream regressions below.
6. Inspect build metadata and replay fixtures. Merge the sync branch into `futrue-v1` only after review.

## Required regression commands

All commands must run with `TURBO_TELEMETRY_DISABLED=1`. Browser suites also set `PUPPETEER_HEADLESS=true`.

```bash
yarn workspace @datainsights/browser-sdk vitest run
yarn workspace @datainsights/browser-sdk check-types
yarn workspace @datainsights/browser-sdk prepublish
yarn workspace @rrweb/record test
yarn workspace rrweb test
yarn turbo run check-types \
  --filter=@datainsights/browser-sdk \
  --filter=@rrweb/record \
  --filter=rrweb
```

Run the browser test commands sequentially. The suites build into shared rrweb `dist` directories; running their `test` tasks together through Turbo can let one build clean artifacts while another suite is reading them.

Review the following evidence explicitly:

- ordinary insurance inputs are present while password and hidden values are absent;
- a page reload recovers the previous Recording's durable Journal;
- segment rotation emits a new full snapshot;
- untrusted replay data cannot execute scripts in the sandbox;
- `dist` contains ESM/CJS/UMD declarations and `serialization.worker.js`;
- `npm pack --dry-run` contains only reviewed package files;
- `git diff --name-only <last-upstream-merge>..HEAD` contains no rrweb core patch unless a patch record was approved.

## Rollback

If an upstream merge fails compatibility or privacy checks, do not update fixtures or weaken assertions to force a pass. Keep `futrue-v1` on the last validated merge commit and delete only the unmerged sync branch. Released applications remain pinned to their prior exact SDK URL/version. IndexedDB schema `datainsights-recorder-v1` must not be deleted during rollback; old Journal and Outbox records remain available to the prior compatible SDK.

If a faulty SDK release has already been published, publish a new patch version built from the last validated source and move application configuration to that exact version. Never repoint a production `latest` URL.
