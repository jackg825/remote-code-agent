import assert from "node:assert/strict";
import test from "node:test";
import { isValidSessionName, parseClientMessage } from "../src/protocol.js";

test("accepts safe tmux session names", () => {
  assert.equal(isValidSessionName("project-one_2"), true);
  assert.equal(isValidSessionName("../other"), false);
  assert.equal(isValidSessionName("space name"), false);
  assert.equal(isValidSessionName("x".repeat(65)), false);
});

test("parses terminal input", () => {
  assert.deepEqual(
    parseClientMessage('{"type":"input","session":"main","data":"claude\\r"}'),
    {
      type: "input",
      session: "main",
      data: "claude\r",
    },
  );
});

test("parses bounded terminal resize messages", () => {
  assert.deepEqual(
    parseClientMessage('{"type":"resize","session":"main","cols":120,"rows":40}'),
    { type: "resize", session: "main", cols: 120, rows: 40 },
  );
  assert.equal(
    parseClientMessage('{"type":"resize","session":"main","cols":2,"rows":40}'),
    null,
  );
  assert.equal(
    parseClientMessage('{"type":"resize","session":"main","cols":120.5,"rows":40}'),
    null,
  );
});

test("parses session subscriptions and heartbeat messages", () => {
  assert.deepEqual(parseClientMessage('{"type":"subscribe","session":"project-2"}'), {
    type: "subscribe",
    session: "project-2",
  });
  assert.deepEqual(parseClientMessage('{"type":"unsubscribe","session":"project-2"}'), {
    type: "unsubscribe",
    session: "project-2",
  });
  assert.deepEqual(parseClientMessage('{"type":"ping"}'), { type: "ping" });
  assert.equal(parseClientMessage('{"type":"subscribe","session":"../other"}'), null);
});

test("accepts legacy terminal messages only with a validated URL session", () => {
  assert.deepEqual(parseClientMessage('{"type":"input","data":"pwd\\r"}', "main"), {
    type: "input",
    session: "main",
    data: "pwd\r",
  });
  assert.equal(parseClientMessage('{"type":"input","data":"pwd\\r"}'), null);
});

test("parses only supported agent and mode combinations", () => {
  assert.deepEqual(
    parseClientMessage(
      '{"type":"launch","session":"main","agent":"claude","mode":"auto"}',
    ),
    { type: "launch", session: "main", agent: "claude", mode: "auto" },
  );
  assert.deepEqual(
    parseClientMessage(
      '{"type":"launch","session":"project","agent":"codex","mode":"read-only"}',
    ),
    { type: "launch", session: "project", agent: "codex", mode: "read-only" },
  );
  assert.equal(
    parseClientMessage(
      '{"type":"launch","session":"main","agent":"codex","mode":"plan"}',
    ),
    null,
  );
  assert.equal(
    parseClientMessage(
      '{"type":"launch","session":"main","agent":"shell","mode":"auto"}',
    ),
    null,
  );
  assert.equal(
    parseClientMessage(
      '{"type":"launch","session":"main","agent":"claude","mode":["auto"]}',
    ),
    null,
  );
  assert.equal(
    parseClientMessage(
      '{"type":"launch","session":"main","agent":"claude","mode":{"toString":null,"valueOf":null}}',
    ),
    null,
  );
});

test("rejects malformed and oversized messages", () => {
  assert.equal(parseClientMessage("not json"), null);
  assert.equal(parseClientMessage('{"type":"unknown"}'), null);
  assert.equal(
    parseClientMessage(
      JSON.stringify({ type: "input", session: "main", data: "x".repeat(65_537) }),
    ),
    null,
  );
});
