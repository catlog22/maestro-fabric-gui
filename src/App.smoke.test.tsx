import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { desktopApi } from "./lib/desktop-api";
import { App } from "./App";

vi.mock("./lib/desktop-api", () => ({
  desktopApi: {
    handshake: vi.fn(),
    getGatewayRuntimeState: vi.fn(),
    startGatewayRuntime: vi.fn(),
    stopGatewayRuntime: vi.fn(),
    restartGatewayRuntime: vi.fn(),
  },
}));

const runtime = {
  status: "stopped" as const,
  desiredRunning: false,
  configPath: "C:/gui/gateway.yaml",
  httpUrl: "http://127.0.0.1:9090/mcp",
  localCredentialRef: "gateway.runtime.local",
  tunnelKind: "openai-managed" as const,
  fabricEnabled: false,
};

const desktop = {
  revision: 1,
  readiness: "ready" as const,
  bridge: {
    protocolVersion: 1 as const,
    bridgeVersion: "0.1.0",
    nodeVersion: "22.18.0",
    readiness: "ready" as const,
    capabilities: [],
    gatewayCompatibility: { available: true, minimumVersion: "0.31.3", compatible: false },
  },
};

describe("App smoke", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(desktopApi.handshake).mockResolvedValue(desktop);
    vi.mocked(desktopApi.getGatewayRuntimeState).mockResolvedValue(runtime);
    vi.mocked(desktopApi.startGatewayRuntime).mockResolvedValue({ ...runtime, status: "running", desiredRunning: true });
    vi.mocked(desktopApi.stopGatewayRuntime).mockResolvedValue(runtime);
    vi.mocked(desktopApi.restartGatewayRuntime).mockResolvedValue({ ...runtime, status: "running", desiredRunning: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the gateway console", async () => {
    render(<App />);
    expect(await screen.findByText("Desktop bridge ready")).toBeTruthy();
  });

  it("confirms overview start and restart when a tunnel is configured", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    await screen.findByText("Desktop bridge ready");

    fireEvent.click(screen.getByRole("button", { name: "Start gateway" }));
    fireEvent.click(screen.getByRole("button", { name: "Restart gateway" }));
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(desktopApi.startGatewayRuntime).not.toHaveBeenCalled();
    expect(desktopApi.restartGatewayRuntime).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Start gateway" }));
    await waitFor(() => expect(desktopApi.startGatewayRuntime).toHaveBeenCalledOnce());
  });

  it("localizes Gateway compatibility status", async () => {
    render(<App />);
    expect(await screen.findByText(/Gateway unavailable \(requires 0\.31\.3\+\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Language" }));
    expect(await screen.findByText(/Gateway 不可用 \(需要 0\.31\.3\+\)/)).toBeTruthy();
  });
});
