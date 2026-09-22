import test from "node:test";
import assert from "node:assert/strict";
import { parseRequest, sanitizeError } from "../dist/protocol.js";

const valid = { id: "1", action: "handshake", deadlineAt: 2000 };
test("parses an allowlisted request", () => assert.equal(parseRequest(valid, 1000).action, "handshake"));
test("rejects arbitrary actions", () => assert.throws(() => parseRequest({ ...valid, action: "shell" }, 1000), /not allowed/));
test("rejects expired requests", () => assert.throws(() => parseRequest(valid, 2000), /expired/));
test("redacts bearer credentials", () => assert.doesNotMatch(sanitizeError(new Error("Bearer secret-value")).message, /secret-value/));
