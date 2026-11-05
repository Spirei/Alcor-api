import assert from "node:assert/strict";
import test from "node:test";
import { trackSortPointer } from "../src/sort-pointer.ts";
function event(type: string, values: Record<string, unknown> = {}) {
  return Object.assign(new Event(type, { cancelable: true }), values);
}
function fixture() {
  const target = new EventTarget(),
    page = Object.assign(new EventTarget(), { hidden: false }),
    calls: string[] = [];
  const cancel = trackSortPointer(
    { pointerId: 1, clientX: 10, clientY: 10 },
    {
      move: () => calls.push("move"),
      end: (moved) => calls.push("end:" + moved),
      cancel: () => calls.push("cancel"),
    },
    target,
    page,
  );
  return { target, page, calls, cancel };
}
test("window release completes reordered elements once and ignores other pointers", () => {
  const f = fixture();
  f.target.dispatchEvent(
    event("pointermove", { pointerId: 2, clientX: 80, clientY: 10 }),
  );
  f.target.dispatchEvent(
    event("pointermove", { pointerId: 1, clientX: 12, clientY: 10 }),
  );
  assert.deepEqual(f.calls, []);
  f.target.dispatchEvent(
    event("pointermove", { pointerId: 1, clientX: 80, clientY: 10 }),
  );
  f.target.dispatchEvent(event("pointercancel", { pointerId: 2 }));
  f.target.dispatchEvent(event("pointerup", { pointerId: 1 }));
  f.target.dispatchEvent(event("pointerup", { pointerId: 1 }));
  f.cancel();
  assert.deepEqual(f.calls, ["move", "end:true"]);
});
test("escape or hiding cancels the preview without committing", () => {
  for (const action of ["escape", "hide", "unmount"]) {
    const f = fixture();
    f.target.dispatchEvent(
      event("pointermove", { pointerId: 1, clientX: 80, clientY: 10 }),
    );
    if (action === "escape")
      f.target.dispatchEvent(event("keydown", { key: "Escape" }));
    else if (action === "hide") {
      f.page.hidden = true;
      f.page.dispatchEvent(event("visibilitychange"));
    } else f.cancel();
    f.target.dispatchEvent(event("pointerup", { pointerId: 1 }));
    assert.deepEqual(f.calls, ["move", "cancel"]);
  }
});
