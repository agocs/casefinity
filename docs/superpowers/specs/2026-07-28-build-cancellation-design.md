# Preemptive build cancellation

Date: 2026-07-28
Status: approved, ready to implement
Affects: `hardcase-gridfinity-generator/src/main.ts`,
new `hardcase-gridfinity-generator/src/cad-session.ts`,
new `hardcase-gridfinity-generator/scripts/session-test.mjs`

## Problem

Today a parameter edit that survives the 2 s debounce (`main.ts:57-61`)
dispatches `worker.mesh()` unconditionally. The worker is single-threaded and
`mesh()` has no await points after the first `init()`, so a second dispatch
cannot be processed until the first handler returns: **dispatched builds queue
FIFO in the worker's message queue, and nothing can preempt or evict them.**
`buildToken` (`main.ts:40,46`) only discards the *result* of a superseded
build; the CPU cost is paid in full.

This is expensive because builds are slow. Measured on this machine (Node,
`replicad_single.wasm` off local disk):

| model | build | mesh |
|---|---|---|
| `perimeter-square-corners` | 53.3 s | 314 ms |
| `perimeter` | 41.7 s | 344 ms |
| `smooth-perimeter` | 31.4 s | 181 ms |
| `perimeter-template` | 5.9 s | 21 ms |
| `bin-double-sided` | 5.6 s | 83 ms |
| `bin-with-lid` | 3.1 s | 75 ms |
| `bin-no-lid` | 1.1 s | 32 ms |
| `solid-block` | 0.9 s | 23 ms |

OCCT kernel init measured 278 ms, plus a 23 ms font load. The in-browser cost
adds a one-time 10.8 MB WASM fetch, HTTP-cached thereafter.

So on the perimeter models, every 2 s of continued editing commits the user to
another ~40 s of compute whose result is thrown away, and the queue is unbounded
in principle. Three nudges to a perimeter parameter is over two minutes of
stale builds.

The decisive ratio: **respawning a worker costs ~0.3–1 s to abandon a 30–53 s
build** — under 1% overhead. `worker.terminate()` is the only way to stop
synchronous OCCT work, since `model.build()` is a chain of opaque WASM boolean
operations with no cooperative cancellation point.

## Requirements

- REQ-1 Dispatching a build while another build is in flight cancels the
  in-flight build.
- REQ-2 The worker's message queue never holds more than one job. Build depth
  is bounded: at most one in flight, at most one deferred.
- REQ-3 An in-flight export is never cancelled. A build requested during an
  export is deferred, not dropped, and not run concurrently.
- REQ-4 A second build requested while one is already deferred replaces it —
  latest wins, never accumulates.
- REQ-5 Export buttons are disabled whenever a build or export is running.
- REQ-6 A cancelled build settles its promise, so callers' `finally` blocks run
  and no UI state is stranded.
- REQ-7 Preemption must not flicker busy-state UI: the spinner stays on and the
  export buttons stay disabled across a cancel-and-redispatch.
- REQ-8 No worker respawn when dispatching from idle.

## Approach

Chosen: **terminate and respawn on demand.** Two alternatives were rejected:

- *Pre-warmed spare worker* — keep an idle warm worker so preemption pays no
  init at all. Rejected as premature: it doubles resident OCCT heap
  permanently, and complicates the lifecycle when preemption outpaces warming,
  to optimize away ~0.3–1 s against a 30–53 s build. It stays the escape hatch
  if browser init measures far worse than Node's.
- *Collapse the queue without cancelling* — a single latest-wins pending slot,
  in-flight build always runs to completion. Smallest change, but the user
  still waits out a 40 s build they have already invalidated. Fails REQ-1.

## Design

### `src/cad-session.ts` (new)

Owns the worker and the concurrency state machine. `main.ts` returns to pure
DOM wiring.

The constructor takes a spawn function returning a `WorkerHandle`
(`{ api, terminate }`) rather than calling `new Worker` itself. This keeps the
module free of browser globals — matching the convention that lets Node import
`src/` sources directly — and lets the Node test drive it with a fake. Use
explicit `.ts` extensions on intra-`src` imports, per the existing rule.

Public surface:

- `build(modelId, values): Promise<Mesh[]>` — rejects with `Cancelled` if
  superseded
- `exportModel(kind, modelId, values): Promise<Blob>`
- `get busy(): boolean`
- `get exporting(): boolean`
- `onBusyChange?: (busy: boolean) => void`

States are *idle*, *building*, *exporting*, plus at most one *deferred* build:

| new request | current state | behavior |
|---|---|---|
| `build` | idle | dispatch to the existing worker; no respawn (REQ-8) |
| `build` | building | terminate worker, reject old with `Cancelled`, spawn fresh, dispatch (REQ-1) |
| `build` | exporting | park in the deferred slot; dispatch when the export settles (REQ-3) |
| `build` | exporting + deferred | reject the parked build with `Cancelled`, replace it (REQ-4) |
| `export` | building | terminate the build, reject it with `Cancelled`, do **not** re-dispatch it, then export — unreachable through the UI, defined for totality |
| `export` | exporting | never cancelled (REQ-3) |

Invariant (REQ-2): at most one job in flight and at most one deferred. "No
queue" is enforced by the session, not by hoping the debounce outlasts the
build.

**Settling on terminate (REQ-6).** After `terminate()`, comlink's in-flight
promise never settles — it hangs forever, and with it any `finally` the caller
wrote. The session therefore retains the `reject` handle for the in-flight job
and rejects it with `Cancelled` at terminate time. The orphaned comlink promise
is dropped along with the dead worker.

**Busy transitions (REQ-7).** `onBusyChange` fires only on real edge
transitions. A preemption keeps `busy === true` throughout; it must not emit
`false` then `true`. The session starts idle and emits nothing until the first
job is dispatched, so the initial DOM state must be authored as idle (spinner
off, exports enabled) rather than relying on a construction-time callback.

Note that a deferred build can only exist while exporting: a build arriving
during a build preempts immediately rather than deferring, so the state
*building + deferred* is unreachable.

### `src/main.ts` (changed)

- **Delete `buildToken` entirely.** It existed to discard stale results;
  cancelled builds now reject, and a stale mesh cannot arrive because its
  worker is dead.
- Collapse both pieces of busy-state UI into one sink:

  ```ts
  session.onBusyChange = (busy) => {
    spinner.classList.toggle("active", busy);
    for (const b of exportButtons) b.disabled = busy;
  };
  ```

  This is where REQ-5 lands, and it removes the hand-rolled disable/enable
  inside `exportModel()`. It also closes a current gap: exports are clickable
  during the initial page-load build.
- `rebuild()` catches `Cancelled` and returns silently. Status text is
  `"building…"`, or `"queued behind export…"` while deferred.

**Unchanged by deliberate choice:**

- The 2 s debounce stays. Preemption makes an over-eager dispatch *correctable*,
  not free — partial work is still discarded and a respawn is still paid — so
  there is no reason to lower it.
- Exports stay enabled during the debounce window. They read `currentValues`,
  so they export exactly what the user just typed; the pending rebuild then
  refreshes the viewer.

## Testing

`scripts/session-test.mjs`, wired as `npm run test:session`. A fake worker
handle with manually-settled promises and a terminate spy — no OCCT, so it runs
in about a second and can sit alongside `npm run build` in CI. This is stateful
concurrency logic whose failure modes are all silent, which is what makes it
worth testing rather than eyeballing in `npm run dev`.

Cases:

1. Build from idle does not terminate (REQ-8).
2. Build during a build terminates exactly once, rejects the old promise with
   `Cancelled`, and resolves the new one (REQ-1, REQ-6).
3. Three rapid builds produce exactly 2 terminates, only the last resolves, and
   the fake never sees two concurrent jobs (REQ-2).
4. Build during an export does not terminate; the export resolves; the deferred
   build dispatches afterward (REQ-3).
5. Two builds during an export leave only the newest; the first rejects with
   `Cancelled` (REQ-4).
6. `onBusyChange` emits `true` once and `false` once across a preemption — no
   flicker (REQ-7).

Manual verification in `npm run dev`: select `perimeter`, edit a parameter, wait
for the build to start, edit again — the first build must stop (not merely be
discarded) and the second must start immediately.

`npm run smoke` is unaffected — no model geometry changes — but should still be
run to confirm no regression.

## Known limitation

Rapid preemption means repeated 10.8 MB WASM instantiation. Node measured
278 ms; if the browser measures far worse, the warm-spare pool is the escape
hatch, and the injected spawn function keeps that a contained change.
