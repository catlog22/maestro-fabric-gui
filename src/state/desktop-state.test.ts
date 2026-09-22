import { describe, expect, it } from "vitest";
import { acceptNewerState } from "./desktop-state";

const ready = { revision: 4, readiness: "ready" as const };
describe("acceptNewerState", () => {
  it("rejects stale snapshots", () => expect(acceptNewerState(ready, { revision: 3, readiness: "unavailable" })).toBe(ready));
  it("accepts equal or newer authoritative snapshots", () => expect(acceptNewerState(ready, { revision: 5, readiness: "unavailable" }).revision).toBe(5));
});
