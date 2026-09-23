import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest, sanitizeError } from "../dist/protocol.js";
import { createBridgeRequestHandler } from "../dist/worker.js";

const valid = { id: "1", action: "handshake", deadlineAt: 2000 };
test("parses an allowlisted request", () => assert.equal(parseRequest(valid, 1000).action, "handshake"));
test("rejects arbitrary actions", () => assert.throws(() => parseRequest({ ...valid, action: "shell" }, 1000), /not allowed/));
test("rejects expired requests", () => assert.throws(() => parseRequest(valid, 2000), /expired/));
test("redacts bearer credentials", () => assert.doesNotMatch(sanitizeError(new Error("Bearer secret-value")).message, /secret-value/));

test("dispatches cancel to the target request AbortController", async () => {
  let started;
  const operationStarted = new Promise((resolve) => { started = resolve; });
  const handler = createBridgeRequestHandler(async (_request, signal) => {
    started();
    return await new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ aborted: true }), { once: true }));
  });
  const deadlineAt = Date.now() + 10_000;
  const operation = handler({ id: "operation-1", action: "gateway.control", deadlineAt, payload: { controlAction: "status" } });
  await operationStarted;
  const cancelled = await handler({ id: "cancel-1", action: "cancel", deadlineAt, payload: { operationId: "operation-1" } });
  assert.deepEqual(cancelled, { id: "cancel-1", ok: true, result: { operationId: "operation-1", cancelled: true } });
  assert.deepEqual(await operation, { id: "operation-1", ok: true, result: { aborted: true } });
});
