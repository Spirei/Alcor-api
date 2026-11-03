import assert from "node:assert/strict";
import test from "node:test";
import {
  migrationState,
  capabilityEntryEvidence,
  migrationProgress,
  migrationDomainState,
  continuationCapsule,
  implementationPlan,
} from "../src/migration-view.ts";

test("capsules mark only this continuation's proved methods", () => {
  assert.equal(continuationCapsule("0.1.76"), "0.1.76");
  assert.equal(continuationCapsule("0.1.89"), "0.1.89");
  assert.equal(continuationCapsule("0.1.68"), null);
  assert.equal(continuationCapsule("0.1.75"), null);
  assert.equal(continuationCapsule("0.2.76"), null);
  assert.equal(continuationCapsule(undefined), null);
  assert.equal(continuationCapsule("0.1"), null);
});

test("migration status distinguishes local verification from full acceptance", () => {
  assert.equal(migrationState("local_verified"), "已本地验证");
  assert.equal(migrationState("in_progress", true), "迁移中");
  assert.equal(migrationState("accepted"), "已验收");
  assert.equal(migrationState("unknown"), "待核实");
  assert.equal(migrationState("pending", true), "待迁移");
  assert.equal(migrationState("pending_validation"), "待验证");
  assert.equal(migrationState("partial_pending_validation"), "部分待验证");
});

test("progress follows current scope without inventing completion for missing or invalid counts", () => {
  assert.equal(migrationProgress(77, 324)?.percent, 23.8);
  assert.equal(migrationProgress(78, 324)?.percent, 24.1);
  assert.equal(migrationProgress(0, 324)?.percent, 0);
  assert.equal(migrationProgress(324, 324)?.percent, 100);
  assert.equal(migrationProgress(9999, 10000)?.percent, 99.9);
  for (const [verified, total] of [
    [0, 0],
    [-1, 10],
    [11, 10],
    [NaN, 10],
    [1, Infinity],
  ])
    assert.equal(migrationProgress(verified, total), null);
});

test("a completed domain replaces its old in-progress marker while partial and empty scopes stay unverified", () => {
  const f12 = ["local_verified", "local_verified", "local_verified"];
  assert.equal(migrationDomainState("in_progress", f12), "local_verified");
  assert.equal(
    migrationDomainState("in_progress", [...f12, "pending"]),
    "in_progress",
  );
  assert.equal(
    migrationDomainState("local_verified", ["local_verified", "pending"]),
    "in_progress",
  );
  assert.equal(migrationDomainState("pending", []), "pending");
  assert.equal(migrationDomainState("local_verified", []), "pending");
  assert.equal(migrationDomainState("retired", f12), "retired");
  assert.equal(migrationDomainState("pending", ["retired"]), "retired");
  assert.equal(
    migrationDomainState("in_progress", [...f12, "retired"]),
    "local_verified",
  );
  assert.equal(
    migrationDomainState("in_progress", ["accepted", "local_verified"]),
    "local_verified",
  );
  assert.equal(
    migrationDomainState("in_progress", ["accepted", "accepted"]),
    "accepted",
  );
});

import type { Capability } from "../src/api";
import {
  capabilityMatches,
  capabilityClientState,
  capabilityClientProgress,
} from "../src/migration-view.ts";

const quote: Capability = {
  id: "cap-quote",
  name: "批量报价",
  method: "POST",
  proposed_path: "/api/market/quotes",
  delivery: "api",
  feature_ids: ["F15"],
  disposition: "shared_candidate",
  constraints: [],
  implementation: {
    status: "local_verified",
    evidence: { clients: { new_web: "local_verified" } },
  },
  clients: { new_web: "local_verified", legacy_web: "pending", ios: "pending" },
  bindings: [
    {
      source_id: "op-quote",
      source_kind: "operation",
      method: "POST",
      path: "/api/v1/quotes",
      protocol: "v1",
      status: "pending",
      accepted: false,
    },
  ],
};

test("search finds an old alias, the new proposal and domain ID without requiring a prefix choice", () => {
  assert.ok(capabilityMatches(quote, " /API/V1/quotes "));
  assert.ok(capabilityMatches(quote, "/api/market/quotes"));
  assert.ok(capabilityMatches(quote, "f15"));
  assert.ok(capabilityMatches(quote, "批量报价"));
  assert.ok(!capabilityMatches(quote, "/api/orders"));
});

test("implementation and an old-version binding never grant client cutover acceptance", () => {
  assert.equal(capabilityClientState([quote], "legacy_web"), "待改接验收");
  assert.equal(capabilityClientState([quote], "ios"), "待适配验收");
  assert.equal(capabilityClientState([], "new_web"), "需专项验收");
  const pending = {
    ...quote,
    implementation: { status: "local_verified" },
    clients: { ...quote.clients, new_web: "pending" },
  };
  assert.equal(
    capabilityClientState([quote, pending], "new_web"),
    "1 项本地验证，其余待完成",
  );
  const accepted = {
    ...quote,
    clients: { ...quote.clients, legacy_web: "accepted" },
  };
  assert.equal(
    capabilityClientState([quote, accepted], "legacy_web"),
    "1 项已验收，其余待完成",
  );
});

test("domain searches do not match incidental hexadecimal fragments in stable capability IDs", () => {
  assert.ok(!capabilityMatches({ ...quote, id: "cap-f16abc" }, "F16"));
});

test("body action contracts expose secondary account paths and action names to search", () => {
  const passkey: Capability = {
    ...quote,
    name: "通行密钥登录与绑定",
    proposed_path: "/api/session/passkeys",
    action_contracts: [
      {
        action: "register-options",
        method: "POST",
        path: "/api/account/passkeys",
        auth: "本人新Web会话 · Origin/CSRF",
        status: "local_verified",
        evidence: {
          version: "0.1.49",
          tests: ["tests/test_legacy_passkeys.py"],
        },
      },
    ],
  };
  assert.ok(capabilityMatches(passkey, " REGISTER-OPTIONS "));
  assert.ok(capabilityMatches(passkey, "/api/account/passkeys"));
  assert.ok(capabilityMatches(passkey, "/api/session/passkeys"));
  assert.ok(!capabilityMatches(passkey, "tests/test_legacy_passkeys.py"));
  assert.equal(capabilityClientState([passkey], "legacy_web"), "待改接验收");
});

test("older server client flags cannot substitute for explicit client proof", () => {
  const inferred = { ...quote, implementation: { status: "local_verified" } };
  assert.equal(capabilityClientState([inferred], "new_web"), "待适配验收");
  const matrix = {
    ...inferred,
    implementation: {
      status: "local_verified",
      evidence: {
        protocol_matrix: [
          { clients: { new_web: "local_verified" } },
          { clients: { ios: "pending" } },
        ],
      },
    },
  };
  assert.equal(capabilityClientState([matrix], "new_web"), "1 项部分验证");
  assert.equal(capabilityClientState([matrix], "ios"), "待适配验收");
  const complete = {
    ...matrix,
    implementation: {
      status: "local_verified",
      evidence: {
        protocol_matrix: [
          { clients: { new_web: "local_verified" } },
          { clients: { new_web: "local_verified" } },
        ],
      },
    },
  };
  assert.equal(
    capabilityClientProgress([complete], "new_web").status,
    "local_verified",
  );
  assert.equal(capabilityClientState([complete], "new_web"), "1 项已本地验证");
});

test("user removal is neither pending work nor client acceptance", () => {
  const removed = {
    ...quote,
    implementation: { status: "retired" },
    clients: { new_web: "retired", legacy_web: "retired", ios: "retired" },
  };
  assert.equal(migrationState("retired", true), "已移除");
  for (const client of ["new_web", "legacy_web", "ios"] as const)
    assert.equal(capabilityClientState([removed], client), "已移除");
  assert.equal(
    capabilityClientState([removed, quote], "legacy_web"),
    "待改接验收",
  );
});

test("implemented candidates stay separate from verification and client acceptance", () => {
  const pending = {
    ...quote,
    key: "POST /api/quotes",
    implementation: { status: "pending" },
    clients: { new_web: "pending", legacy_web: "pending", ios: "pending" },
  };
  const plan = {
    capabilities: [pending],
    summary: { implementation_local_verified: 0, legacy_local_verified: 0 },
    bindings: [],
  } as unknown as import("../src/api").CapabilityPlan;
  const original = JSON.stringify(plan);
  const stage = {
    key: "POST /api/quotes",
    status: "pending_validation" as const,
    version: "0.1.95",
    implementation_files: ["backend/alcor_api/legacy_quote_api.py"],
    routes: [{ method: "POST", path: "/api/market/quotes/read" }],
    pending_validation: ["contract"],
  };
  const result = implementationPlan(plan, [stage])!;
  assert.equal(
    result.capabilities[0].implementation.status,
    "pending_validation",
  );
  assert.equal(result.summary, plan.summary);
  assert.equal(result.capabilities[0].clients, pending.clients);
  assert.equal(result.capabilities[0].bindings, pending.bindings);
  assert.equal(JSON.stringify(plan), original);
  assert.equal(
    implementationPlan(plan, [])!.capabilities[0].implementation.status,
    "pending",
  );
  assert.equal(
    implementationPlan(
      { ...plan, capabilities: [{ ...quote, key: stage.key }] },
      [stage],
    )!.capabilities[0].implementation.status,
    "local_verified",
  );
});

test("client status icons do not promote local proof or partial acceptance to full acceptance", () => {
  assert.equal(
    capabilityClientProgress([quote], "new_web").status,
    "local_verified",
  );
  assert.equal(
    capabilityClientProgress([quote], "legacy_web").status,
    "pending",
  );
  const accepted = {
    ...quote,
    clients: { ...quote.clients, legacy_web: "accepted" },
  };
  assert.equal(
    capabilityClientProgress([accepted], "legacy_web").status,
    "accepted",
  );
  assert.equal(
    capabilityClientProgress([quote, accepted], "legacy_web").status,
    "in_progress",
  );
  assert.equal(capabilityClientProgress([], "ios").status, "review");
  const removed = { ...quote, implementation: { status: "retired" } };
  assert.equal(capabilityClientProgress([removed], "ios").status, "retired");
});

test("non API source staging projects work status without fabricating capabilities or proof", () => {
  const summary = { implementation_local_verified: 1, legacy_local_verified: 1 };
  const plan = {summary,capabilities:[quote],bindings:[],non_api_work:[
    {feature_id:'F38',name:'worker',status:'pending'},
    {feature_id:'F39',name:'cache',status:'pending'},
  ]} as unknown as import('../src/api').CapabilityPlan;
  const stage = {key:'non_api:F38',feature_id:'F38',status:'pending_validation' as const,
    version:'0.1.120',implementation_files:['backend/alcor_api/worker.py'],
    routes:[{method:'GET',path:'/api/tasks'}],pending_validation:['runtime']};
  const partial = {...stage,key:'non_api:F39',feature_id:'F39',status:'partial_pending_validation' as const};
  const original = JSON.stringify(plan);
  const result = implementationPlan(plan,[stage,partial])!;
  assert.deepEqual(result.non_api_work.map(work=>work.status),['pending_validation','partial_pending_validation']);
  assert.equal(result.capabilities.length,1);
  assert.equal(result.capabilities[0],quote);
  assert.equal(result.summary,summary);
  assert.equal(JSON.stringify(plan),original);
  assert.equal(migrationDomainState('pending',[],result.non_api_work[0].status),'pending_validation');
  assert.equal(migrationDomainState('pending',[],result.non_api_work[1].status),'partial_pending_validation');
  assert.equal(migrationDomainState('retired',[],stage.status),'retired');
  for (const invalid of [{...stage,feature_id:'F39'},{...stage,version:''},{...stage,implementation_files:[]},{...stage,routes:[]}]) {
    assert.equal(implementationPlan(plan,[invalid])!.non_api_work[0].status,'pending');
  }
  const proved = {...plan,non_api_work:[{feature_id:'F38',name:'worker',status:'local_verified'}]};
  assert.equal(implementationPlan(proved,[stage])!.non_api_work[0].status,'local_verified');
});


test("legacy protocol proofs keep suggested URLs separate from actual verified routes", () => {
  const evidence = {verification_scope: "legacy_protocol_only", runtime_routes: [
    {method: "POST", path: "/api/v{version}/broker-accounts/{account_id}/statements/apply"},
    {method: "POST", path: "/api/v1/broker-accounts/{account_id}/statements/apply"},
  ]};
  const result = capabilityEntryEvidence({status: "local_verified", evidence});
  assert.equal(result.label, "建议入口");
  assert.equal(result.legacyOnly, true);
  assert.deepEqual(result.routes, [
    {method: "POST", path: "/api/v1/broker-accounts/{account_id}/statements/apply"},
    {method: "POST", path: "/api/v2/broker-accounts/{account_id}/statements/apply"},
  ]);
  assert.deepEqual(capabilityEntryEvidence({status: "pending_validation", evidence}).routes, []);
  assert.equal(capabilityEntryEvidence({status: "local_verified"}).label, "本地实现");
  assert.equal(capabilityEntryEvidence({status: "pending"}).label, "建议入口");
});

test("malformed route metadata cannot become verified runtime evidence", () => {
  const result = capabilityEntryEvidence({status: "local_verified", evidence: {runtime_routes: [
    null, {method: "unknown", path: "/api/not-http"}, {method: "GET", path: "//elsewhere.invalid"},
    {method: "GET", path: "/api/space path"}, {method: "GET", path: "/api/actual"},
  ]}});
  assert.deepEqual(result.routes, [{method: "GET", path: "/api/actual"}]);
});
