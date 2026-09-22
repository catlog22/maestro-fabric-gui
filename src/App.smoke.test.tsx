import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App smoke", () => {
  it("renders the gateway console outside the Tauri runtime", () => {
    render(<App />);
    expect(screen.getByText(/Maestro/)).toBeTruthy();
  });
});
