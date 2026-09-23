import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../../i18n";
import { defaultGatewayRuntimeConfig, type GatewayRuntimeConfig } from "../../models/gateway";
import { desktopApi } from "../../lib/desktop-api";
import { GatewayPanel } from "./GatewayPanel";

vi.mock("../../lib/desktop-api", () => ({
  desktopApi: {
    getGatewayRuntimeConfig: vi.fn(),
    getGatewayRuntimeState: vi.fn(),
    saveGatewayRuntimeConfig: vi.fn(),
    startGatewayRuntime: vi.fn(),
    stopGatewayRuntime: vi.fn(),
    restartGatewayRuntime: vi.fn(),
    importGatewayCredentials: vi.fn(),
    gatewayControl: vi.fn(),
    connectGateway: vi.fn(),
    listGatewayProfiles: vi.fn(),
    disconnectGateway: vi.fn(),
  },
}));

const state = { status: "stopped" as const, desiredRunning: false, configPath: "C:/gui/config.yaml", httpUrl: "http://127.0.0.1:9090/mcp", localCredentialRef: "gateway.runtime.local", tunnelKind: "none" as const, fabricEnabled: false };
const openAiConfig: GatewayRuntimeConfig = {
  ...defaultGatewayRuntimeConfig(),
  tunnel: { kind: "openai-managed", profileId: "openai-managed", tunnelIdCredentialRef: "gateway.openai.tunnel-id", runtimeKeyCredentialRef: "gateway.openai.runtime-key", autoInstall: false, credentialTtlMs: 300_000 },
};

describe("GatewayPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(desktopApi.getGatewayRuntimeConfig).mockResolvedValue(defaultGatewayRuntimeConfig());
    vi.mocked(desktopApi.getGatewayRuntimeState).mockResolvedValue(state);
    vi.mocked(desktopApi.saveGatewayRuntimeConfig).mockResolvedValue(state);
    vi.mocked(desktopApi.startGatewayRuntime).mockResolvedValue({ ...state, status: "running", desiredRunning: true, pid: 42 });
    vi.mocked(desktopApi.importGatewayCredentials).mockResolvedValue(undefined);
    vi.mocked(desktopApi.gatewayControl).mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps direct Gateway as the default and models OpenAI as a URL-less optional tunnel", async () => {
    render(<LocaleProvider locale="en"><GatewayPanel section="Gateway" /></LocaleProvider>);
    expect(await screen.findByText("Direct Gateway")).toBeTruthy();
    const summary = screen.getByText((_, element) => element?.classList.contains("runtime-summary") === true);
    expect(summary.textContent).toContain("Stopped");
    expect(summary.textContent).not.toContain("stopped");
    fireEvent.change(screen.getByLabelText("External access"), { target: { value: "openai-managed" } });
    expect(screen.getByLabelText("Tunnel ID credential reference")).toBeTruthy();
    expect(screen.queryByLabelText("Public HTTPS origin")).toBeNull();
  });

  it("persists desired state before starting the supervised runtime", async () => {
    render(<LocaleProvider locale="en"><GatewayPanel section="Gateway" /></LocaleProvider>);
    const button = await screen.findByRole("button", { name: "Save & start" });
    fireEvent.click(button);
    await waitFor(() => expect(desktopApi.saveGatewayRuntimeConfig).toHaveBeenCalledWith(expect.objectContaining({ desiredRunning: true })));
    expect(desktopApi.startGatewayRuntime).toHaveBeenCalledOnce();
  });

  it("confirms save and start when it would activate a configured tunnel", async () => {
    vi.mocked(desktopApi.getGatewayRuntimeConfig).mockResolvedValue(openAiConfig);
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<LocaleProvider locale="en"><GatewayPanel section="Gateway" /></LocaleProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Save & start" }));
    expect(window.confirm).toHaveBeenCalledWith("Confirm Save & start? This also activates the configured external tunnel.");
    expect(desktopApi.saveGatewayRuntimeConfig).not.toHaveBeenCalled();
    expect(desktopApi.startGatewayRuntime).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Save & start" }));
    await waitFor(() => expect(desktopApi.startGatewayRuntime).toHaveBeenCalledOnce());
  });

  it("does not confirm tunnel status but confirms start, stop, and restart", async () => {
    vi.mocked(desktopApi.getGatewayRuntimeConfig).mockResolvedValue(openAiConfig);
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<LocaleProvider locale="en"><GatewayPanel section="Settings" /></LocaleProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Check tunnel status" }));
    await waitFor(() => expect(desktopApi.gatewayControl).toHaveBeenCalledWith("tunnel.profile.status", expect.objectContaining({ profile: "openai-managed" }), 120_000));
    expect(window.confirm).not.toHaveBeenCalled();

    for (const label of ["Start tunnel", "Stop tunnel", "Restart tunnel"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    expect(window.confirm).toHaveBeenCalledTimes(3);
    expect(desktopApi.gatewayControl).toHaveBeenCalledTimes(1);

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Start tunnel" }));
    await waitFor(() => expect(desktopApi.gatewayControl).toHaveBeenCalledWith("tunnel.profile.start", expect.objectContaining({ profile: "openai-managed" }), 120_000));
  });

  it("preserves the credential source file by default without prompting", async () => {
    render(<LocaleProvider locale="en"><GatewayPanel section="Gateway" /></LocaleProvider>);
    await screen.findByText("Direct Gateway");
    fireEvent.change(screen.getByLabelText("External access"), { target: { value: "openai-managed" } });
    fireEvent.change(screen.getByLabelText("Credential env file"), { target: { value: " C:/secure/openai.env " } });
    fireEvent.click(screen.getByRole("button", { name: "Import into OS credential store" }));

    await waitFor(() => expect(desktopApi.importGatewayCredentials).toHaveBeenCalledWith(expect.objectContaining({ path: "C:/secure/openai.env", deleteAfterImport: false })));
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("deletes the credential source file only after opt-in and confirmation", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<LocaleProvider locale="en"><GatewayPanel section="Gateway" /></LocaleProvider>);
    await screen.findByText("Direct Gateway");
    fireEvent.change(screen.getByLabelText("External access"), { target: { value: "openai-managed" } });
    fireEvent.change(screen.getByLabelText("Credential env file"), { target: { value: "C:/secure/openai.env" } });
    fireEvent.click(screen.getByLabelText("Delete the source file after import"));
    fireEvent.click(screen.getByRole("button", { name: "Import into OS credential store" }));
    expect(window.confirm).toHaveBeenCalledWith("Import the credentials and permanently delete the source file?");
    expect(desktopApi.importGatewayCredentials).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Import into OS credential store" }));
    await waitFor(() => expect(desktopApi.importGatewayCredentials).toHaveBeenCalledWith(expect.objectContaining({ deleteAfterImport: true })));
  });

  it("renders provider, lifecycle actions, runtime status, and prompts from the Chinese dictionary", async () => {
    vi.mocked(desktopApi.getGatewayRuntimeConfig).mockResolvedValue(openAiConfig);
    const view = render(<LocaleProvider locale="zh"><GatewayPanel section="Gateway" /></LocaleProvider>);
    expect(await screen.findByRole("option", { name: "OpenAI 托管隧道" })).toBeTruthy();
    expect(screen.getByText((_, element) => element?.classList.contains("runtime-summary") === true).textContent).toContain("已停止");
    view.rerender(<LocaleProvider locale="zh"><GatewayPanel section="Settings" /></LocaleProvider>);
    expect(await screen.findByRole("button", { name: "查看隧道状态" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "启动隧道" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "停止隧道" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "重启隧道" })).toBeTruthy();
  });
});
