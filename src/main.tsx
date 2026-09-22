import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

interface ErrorBoundaryState { error?: Error; }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Maestro Gateway Console failed to render", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main style={{ minHeight: "100vh", padding: "40px", background: "#0d0f14", color: "#e9ebf2", fontFamily: "system-ui, sans-serif" }}>
      <h1>Maestro Gateway Console</h1>
      <h2>界面启动失败 / Interface failed to start</h2>
      <p>{this.state.error.message}</p>
      <p>请关闭并重新启动桌面应用。 / Close and restart the desktop application.</p>
    </main>;
  }
}

createRoot(document.getElementById("root")!).render(<StrictMode><ErrorBoundary><App /></ErrorBoundary></StrictMode>);
