import { describe, expect, it } from "vitest";
import { acceptGatewaySnapshot, type GatewaySnapshot } from "./gateway";
const current: GatewaySnapshot = { profileId: "local", connectionGeneration: 2, snapshotRevision: 4, workspaces: [] };
describe("acceptGatewaySnapshot", () => {
  it("rejects another profile", () => expect(acceptGatewaySnapshot(current, { ...current, profileId: "remote", snapshotRevision: 5 })).toBe(current));
  it("rejects a stale connection generation", () => expect(acceptGatewaySnapshot(current, { ...current, connectionGeneration: 1, snapshotRevision: 5 })).toBe(current));
  it("rejects a stale revision", () => expect(acceptGatewaySnapshot(current, { ...current, snapshotRevision: 3 })).toBe(current));
  it("accepts a current authoritative revision", () => expect(acceptGatewaySnapshot(current, { ...current, snapshotRevision: 5 })?.snapshotRevision).toBe(5));
});
