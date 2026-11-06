import assert from "node:assert/strict";
import test from "node:test";
import {
  SimpleLedgerNavigation,
  changeSimpleLedgerStep,
} from "../src/simple-app-navigation.ts";

function historyHarness(currentUrl = "/simple-app") {
  const entries = [
    { url: "/portfolio", state: { idx: 0 } as Record<string, unknown> },
    { url: currentUrl, state: { idx: 1 } as Record<string, unknown> },
  ];
  let position = 1,
    guarded = false,
    active = true;
  const queue: (() => void)[] = [],
    answers: ((value: boolean) => void)[] = [],
    applied: string[] = [],
    moves: number[] = [];
  const createGuard = () =>
    new SimpleLedgerNavigation({
      read: () => entries[position],
      replace: (state, url) => {
        entries[position] = { state, url };
      },
      push: (state, url) => {
        entries.splice(position + 1);
        entries.push({ state, url });
        position++;
      },
      move: (delta) => {
        moves.push(delta);
        const target = position + delta;
        assert.ok(target >= 0 && target < entries.length);
        queue.push(() => {
          position = target;
          guard.pop();
        });
      },
      guarded: () => guarded,
      active: () => active,
      confirm: () => new Promise((resolve) => answers.push(resolve)),
      apply: () => applied.push(entries[position].url),
    });
  let guard = createGuard();
  return {
    get guard() {
      return guard;
    },
    recreate: () => {
      guard.dispose();
      guard = createGuard();
    },
    entries,
    answers,
    applied,
    moves,
    guarded: (v: boolean) => {
      guarded = v;
    },
    active: (v: boolean) => {
      active = v;
    },
    url: () => entries[position].url,
    index: () => position,
    userMove: (delta: number) => {
      position += delta;
      assert.ok(position >= 0 && position < entries.length);
      return guard.pop();
    },
    flush: () => {
      let count = 0;
      while (queue.length) {
        assert.ok(++count < 20, "history traversal must not loop");
        queue.shift()!();
      }
    },
  };
}
const settle = async (
  h: ReturnType<typeof historyHarness>,
  answer: boolean,
) => {
  h.answers.shift()!(answer);
  await Promise.resolve();
  h.flush();
};

test("back keeps the edited page mounted, rejection restores its URL without pushing history", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=addInvest");
  const length = h.entries.length;
  h.guarded(true);
  assert.equal(h.userMove(-1), true);
  h.flush();
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.deepEqual(h.applied, []);
  await settle(h, false);
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.equal(h.entries.length, length);
  assert.deepEqual(h.moves, [1]);
  assert.deepEqual(h.applied, []);
  assert.equal(h.answers.length, 0);
});
test("accepted back traversal is released exactly once even when editing remains true", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=addInvest");
  h.guarded(true);
  h.userMove(-1);
  h.flush();
  await settle(h, true);
  assert.equal(h.url(), "/simple-app");
  assert.deepEqual(h.moves, [1, -1]);
  assert.deepEqual(h.applied, ["/simple-app"]);
  assert.equal(h.answers.length, 0);
});
test("forward rejection preserves both the current form and the existing forward destination", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=invest");
  h.guard.push("/simple-app?page=addInvest");
  h.userMove(-1);
  h.guarded(true);
  h.applied.length = 0;
  const length = h.entries.length;
  h.userMove(1);
  h.flush();
  await settle(h, false);
  assert.equal(h.url(), "/simple-app?page=invest");
  assert.equal(h.entries.length, length);
  assert.equal(h.entries[h.index() + 1].url, "/simple-app?page=addInvest");
  assert.deepEqual(h.applied, []);
  h.userMove(1);
  h.flush();
  await settle(h, true);
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.deepEqual(h.applied, ["/simple-app?page=addInvest"]);
});
test("rapid repeated back attempts share one confirmation and stay bounded", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=invest");
  h.guard.push("/simple-app?page=addInvest");
  h.guarded(true);
  h.userMove(-1);
  h.userMove(-1);
  h.flush();
  assert.equal(h.answers.length, 1);
  await settle(h, false);
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.deepEqual(h.applied, []);
});
test("late approval after deactivation or disposal cannot navigate", async () => {
  for (const dispose of [false, true]) {
    const h = historyHarness();
    h.guard.push("/simple-app?page=addInvest");
    h.guarded(true);
    h.userMove(-1);
    h.flush();
    if (dispose) h.guard.dispose();
    else h.active(false);
    await settle(h, true);
    assert.equal(h.url(), "/simple-app?page=addInvest");
    assert.deepEqual(h.moves, [1]);
    assert.deepEqual(h.applied, []);
  }
});
test("a Router-only previous entry survives cancellation and remains reachable on the next back", async () => {
  const h = historyHarness("/simple-app?page=addInvest");
  const original = structuredClone(h.entries[0]);
  h.guarded(true);
  assert.equal(h.userMove(-1), true);
  h.flush();
  await settle(h, false);
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.equal(h.entries.length, 2);
  assert.deepEqual(h.entries[0], original);
  assert.deepEqual(h.moves, [1]);
  h.guarded(false);
  assert.equal(h.userMove(-1), false);
  assert.equal(h.url(), "/portfolio");
  assert.deepEqual(h.applied, ["/portfolio"]);
});
test("approval reaches a Router-only previous entry once without adding history", async () => {
  const h = historyHarness("/simple-app?page=addInvest");
  const original = structuredClone(h.entries[0]);
  h.guarded(true);
  h.userMove(-1);
  h.flush();
  await settle(h, true);
  assert.equal(h.url(), "/portfolio");
  assert.equal(h.entries.length, 2);
  assert.deepEqual(h.entries[0], original);
  assert.deepEqual(h.moves, [1, -1]);
  assert.deepEqual(h.applied, ["/portfolio"]);
});
test("older unindexed entries keep their original URL after rejection and remain reachable", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=addInvest");
  h.entries[1] = { url: "/simple-app?page=legacy", state: {} };
  const length = h.entries.length;
  h.guarded(true);
  h.userMove(-1);
  await settle(h, false);
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.equal(h.entries.length, length);
  assert.equal(h.entries[h.index() - 1].url, "/simple-app?page=legacy");
  assert.deepEqual(h.moves, []);
  assert.deepEqual(h.applied, []);
  h.guarded(false);
  assert.equal(h.userMove(-1), false);
  assert.equal(h.url(), "/simple-app?page=legacy");
});
test("an unindexed back destination is released once after approval", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=addInvest");
  h.entries[1] = {
    url: "/simple-app?page=legacy",
    state: { usr: { preserved: true } },
  };
  h.guarded(true);
  h.userMove(-1);
  await settle(h, true);
  assert.equal(h.url(), "/simple-app?page=legacy");
  assert.equal(h.entries.length, 3);
  assert.deepEqual(h.entries[1].state.usr, { preserved: true });
  assert.deepEqual(h.applied, ["/simple-app?page=legacy"]);
  assert.deepEqual(h.moves, [-1]);
});
test("repeated cancellation of an unindexed destination uses the same bounded recovery anchor", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=addInvest");
  h.entries[1] = { url: "/simple-app?page=legacy", state: {} };
  h.guarded(true);
  for (let attempt = 0; attempt < 4; attempt++) {
    h.userMove(-1);
    h.flush();
    await settle(h, false);
    assert.equal(h.url(), "/simple-app?page=addInvest");
    assert.equal(h.entries.length, 3);
    assert.equal(h.entries[1].url, "/simple-app?page=legacy");
  }
  h.userMove(-1);
  h.flush();
  await settle(h, true);
  assert.equal(h.url(), "/simple-app?page=legacy");
  assert.equal(h.answers.length, 0);
  assert.deepEqual(h.applied, ["/simple-app?page=legacy"]);
});
test("reopening a recovery anchor retains its adjacent original destination", async () => {
  const h = historyHarness();
  h.guard.push("/simple-app?page=addInvest");
  h.entries[1] = { url: "/simple-app?page=legacy", state: {} };
  h.guarded(true);
  h.userMove(-1);
  await settle(h, false);
  h.recreate();
  h.userMove(-1);
  h.flush();
  await settle(h, false);
  assert.equal(h.url(), "/simple-app?page=addInvest");
  assert.equal(h.entries.length, 3);
  assert.equal(h.entries[1].url, "/simple-app?page=legacy");
  h.guarded(false);
  h.userMove(-1);
  assert.equal(h.url(), "/simple-app?page=legacy");
});
test("cashflow step rejection and selecting the current step preserve the pending editor", async () => {
  let step = "income",
    editing = { name: "未保存的收入", amount: "123.45" },
    prompts = 0;
  const apply = (next: string) => {
    step = next;
    editing = null as any;
  };
  assert.equal(
    await changeSimpleLedgerStep(
      step,
      "expense",
      true,
      async () => {
        prompts++;
        return false;
      },
      apply,
    ),
    false,
  );
  assert.equal(step, "income");
  assert.equal(editing.amount, "123.45");
  assert.equal(prompts, 1);
  assert.equal(
    await changeSimpleLedgerStep(
      step,
      "income",
      true,
      async () => {
        prompts++;
        return true;
      },
      apply,
    ),
    false,
  );
  assert.equal(editing.amount, "123.45");
  assert.equal(prompts, 1);
  assert.equal(
    await changeSimpleLedgerStep(
      step,
      "expense",
      true,
      async () => true,
      apply,
    ),
    true,
  );
  assert.equal(step, "expense");
  assert.equal(editing, null);
});
test("a stale step approval cannot clear a replacement or unmounted editor", async () => {
  let called = false;
  assert.equal(
    await changeSimpleLedgerStep(
      "income",
      "expense",
      true,
      async () => true,
      () => {
        called = true;
      },
      () => false,
    ),
    false,
  );
  assert.equal(called, false);
});
