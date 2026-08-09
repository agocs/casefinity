// Unit test for the CadSession concurrency state machine. Uses a fake worker
// handle with manually-settled promises, so it never loads OCCT and runs in
// about a second. Node strips the types from cad-session.ts on import; its
// `import type` lines are erased, so ./worker.ts and ./models are never
// actually resolved here.
import assert from "node:assert/strict";

const { CadSession, Cancelled } = await import("../src/cad-session.ts");

/**
 * A spawn function plus the list of workers it has handed out. Each fake
 * records the calls made to it and lets the test settle them by hand, so the
 * test controls exactly when a "build" finishes.
 */
function makeSpawn() {
  const spawned = [];
  const spawn = () => {
    const calls = [];
    const record = (method) => (modelId, values) => {
      let settle;
      const promise = new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
      calls.push({ method, modelId, values, ...settle });
      return promise;
    };
    const handle = {
      terminated: false,
      calls,
      api: {
        mesh: record("mesh"),
        exportSTL: record("exportSTL"),
        exportSTEP: record("exportSTEP"),
        export3MF: record("export3MF"),
      },
      terminate: () => {
        handle.terminated = true;
      },
    };
    spawned.push(handle);
    return handle;
  };
  return { spawn, spawned };
}

const terminatedCount = (spawned) => spawned.filter((h) => h.terminated).length;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("build from idle dispatches without respawning", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const built = session.build("bin-no-lid", { n: 1 });

  assert.equal(spawned.length, 1, "must reuse the worker it started with");
  assert.equal(spawned[0].terminated, false);
  assert.equal(spawned[0].calls.length, 1);
  assert.equal(spawned[0].calls[0].method, "mesh");

  spawned[0].calls[0].resolve(["MESHES"]);
  assert.deepEqual(await built, ["MESHES"]);
});

test("a build during a build terminates the first and rejects it", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const first = session.build("perimeter", { n: 1 });
  const second = session.build("perimeter", { n: 2 });

  await assert.rejects(first, (e) => e instanceof Cancelled);
  assert.equal(spawned.length, 2, "must respawn after terminating");
  assert.equal(spawned[0].terminated, true);
  assert.equal(spawned[1].terminated, false);
  assert.equal(spawned[1].calls[0].values.n, 2, "the newest values must win");

  spawned[1].calls[0].resolve(["SECOND"]);
  assert.deepEqual(await second, ["SECOND"]);
});

test("three rapid builds terminate twice and never queue", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const a = session.build("perimeter", { n: 1 });
  const b = session.build("perimeter", { n: 2 });
  const c = session.build("perimeter", { n: 3 });

  await assert.rejects(a, (e) => e instanceof Cancelled);
  await assert.rejects(b, (e) => e instanceof Cancelled);
  assert.equal(terminatedCount(spawned), 2);
  assert.equal(spawned.length, 3);
  for (const handle of spawned) {
    assert.equal(handle.calls.length, 1, "a worker must never receive a second job");
  }

  spawned[2].calls[0].resolve(["THIRD"]);
  assert.deepEqual(await c, ["THIRD"]);
});

test("onBusyChange does not flicker across a preemption", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);
  const events = [];
  session.onBusyChange = (busy) => events.push(busy);

  const first = session.build("perimeter", { n: 1 });
  const second = session.build("perimeter", { n: 2 });
  await assert.rejects(first, (e) => e instanceof Cancelled);

  assert.deepEqual(events, [true], "must stay busy while redispatching");

  spawned[1].calls[0].resolve([]);
  await second;
  assert.deepEqual(events, [true, false]);
});

test("a build during an export defers instead of killing the export", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const exported = session.exportModel("stl", "perimeter", { n: 1 });
  const built = session.build("perimeter", { n: 2 });

  assert.equal(spawned.length, 1, "an export must never be preempted");
  assert.equal(spawned[0].terminated, false);
  assert.equal(spawned[0].calls.length, 1, "the build must not be dispatched yet");
  assert.equal(session.exporting, true);

  spawned[0].calls[0].resolve("BLOB");
  assert.equal(await exported, "BLOB");

  assert.equal(spawned[0].calls.length, 2, "the deferred build runs once the export lands");
  assert.equal(spawned[0].calls[1].method, "mesh");
  spawned[0].calls[1].resolve(["DEFERRED"]);
  assert.deepEqual(await built, ["DEFERRED"]);
});

test("a second build during an export replaces the deferred one", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const exported = session.exportModel("3mf", "perimeter", { n: 1 });
  const first = session.build("perimeter", { n: 2 });
  const second = session.build("perimeter", { n: 3 });

  await assert.rejects(first, (e) => e instanceof Cancelled);
  assert.equal(spawned[0].calls.length, 1, "deferred builds must not accumulate");

  spawned[0].calls[0].resolve("BLOB");
  await exported;

  assert.equal(spawned[0].calls[1].values.n, 3, "the newest deferred build wins");
  spawned[0].calls[1].resolve(["SECOND"]);
  assert.deepEqual(await second, ["SECOND"]);
});

// replicad's named STEP writer double-frees an OCCT work session on every call,
// so the session retires the worker after each STEP export. See exportModel.
test("a STEP export retires the worker once the blob is delivered", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const exported = session.exportModel("step", "perimeter", { n: 1 });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].terminated, false, "the worker must survive until the blob lands");

  spawned[0].calls[0].resolve("BLOB");
  assert.equal(await exported, "BLOB", "the blob must still be delivered");

  assert.equal(spawned[0].terminated, true, "the leaking worker must be retired");
  assert.equal(spawned.length, 2, "a fresh worker must replace it");
  assert.equal(spawned[1].terminated, false);
});

test("a STEP export leaves its deferred build on the fresh worker", async () => {
  const { spawn, spawned } = makeSpawn();
  const session = new CadSession(spawn);

  const exported = session.exportModel("step", "perimeter", { n: 1 });
  const built = session.build("perimeter", { n: 2 });

  spawned[0].calls[0].resolve("BLOB");
  await exported;

  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].calls.length, 1, "the retired worker must not be handed the build");
  assert.equal(spawned[1].calls.length, 1, "the deferred build runs on the replacement");
  assert.equal(spawned[1].calls[0].method, "mesh");
  spawned[1].calls[0].resolve(["DEFERRED"]);
  assert.deepEqual(await built, ["DEFERRED"]);
});

test("STL and 3MF exports keep the worker alive", async () => {
  for (const kind of ["stl", "3mf"]) {
    const { spawn, spawned } = makeSpawn();
    const session = new CadSession(spawn);

    const exported = session.exportModel(kind, "perimeter", { n: 1 });
    spawned[0].calls[0].resolve("BLOB");
    await exported;

    assert.equal(spawned.length, 1, `${kind} must not respawn the worker`);
    assert.equal(spawned[0].terminated, false, `${kind} must not terminate the worker`);
  }
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL - ${name}`);
    console.log(String(error?.message ?? error).replace(/^/gm, "       "));
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
