# DataInsights Browser SDK compatibility

This matrix records evidence for the IndexedDB durability gate used by
DI-1001. A browser name in this table is not a claim of support unless its
status is `Manual Passed` and the tested version/device evidence is recorded.

## Status meanings

- `Automated`: exercised by repeatable local or CI automation. Desktop mobile
  viewport emulation does not count as a mobile-device result.
- `Manual Passed`: exercised on the named physical device/runtime with the
  recording, reload recovery, delivery, and replay checklist completed.
- `Pending`: no qualifying physical-device evidence has been recorded yet.

## Compatibility matrix

| Runtime                            | Status    | Current evidence                                                                                                | Required next evidence                                                   |
| ---------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| iOS Safari                         | Pending   | None; desktop emulation is not accepted                                                                         | Physical supported iPhone/iPad versions, normal and Private Browsing     |
| Android Chrome                     | Pending   | None; desktop mobile viewport is not accepted                                                                   | Physical Android devices across the agreed minimum/current versions      |
| WeChat / Enterprise WeChat WebView | Pending   | None                                                                                                            | Physical iOS and Android WeChat plus Enterprise WeChat WebViews          |
| Alipay WebView                     | Pending   | None                                                                                                            | Physical iOS and Android Alipay WebViews                                 |
| Windows Chrome                     | Pending   | No Windows runner evidence                                                                                      | Windows desktop automated suite and manual durability/recovery checklist |
| Windows Edge                       | Pending   | No Windows runner evidence                                                                                      | Windows desktop automated suite and manual durability/recovery checklist |
| macOS Chrome                       | Automated | Real browser Script Tag integration on macOS; IndexedDB capability logic also has fake-indexeddb boundary tests | Manual persistence, quota pressure, reload and browser-restart checklist |
| macOS Safari                       | Pending   | No Safari runner evidence                                                                                       | macOS Safari automated/manual durability and recovery checklist          |

## Runtime gate

After consent and before rrweb starts, the SDK must successfully open its
versioned database and complete an actual metadata-store write, exact read-back
and delete transaction. Failure returns `PERSISTENCE_UNAVAILABLE`; production
recording does not fall back to memory-only buffering.

`navigator.storage.estimate()`, `persisted()` and `persist()` are advisory.
Their supported/denied state is exposed through sanitized debug capability
fields. A denied persistence request does not invalidate a successful
IndexedDB transaction, but it also must not be reported as persisted.

## Manual device checklist

For each Pending runtime, record the exact OS, browser/app version, device and
date, then verify:

1. No IndexedDB access and no recording before consent.
2. The first authorized start passes the open/write/read/delete gate.
3. Ordinary insurance form values are recorded while passwords remain absent.
4. Offline batches survive reload and are delivered in FIFO order after
   reconnecting.
5. A matching persisted receipt clears the local Outbox; mismatched receipts
   do not.
6. Quota or transaction denial fails closed without disrupting the host page.
7. Recorded rrweb events rebuild in the script-disabled replay sandbox.

Clearing site data, browser storage eviction, device failure and a crash before
an IndexedDB transaction commits remain unavoidable loss boundaries; this SDK
does not claim absolute zero data loss.
