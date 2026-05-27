import { Component, type ReactNode } from "react";

interface State {
  err: Error | null;
}

/**
 * ErrorBoundary topo de árvore. Em vez de virar tela preta quando algum
 * componente lança no render, mostra o erro real na tela — fundamental
 * pra debug em TV boxes onde o usuário não vê console.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", err, info);
  }

  render() {
    if (this.state.err) {
      const err = this.state.err;
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            padding: 16,
            font: "13px/1.4 monospace",
            color: "#fff",
            background: "#7f1d1d",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            zIndex: 2147483647,
          }}
        >
          {"LN TV — erro no React\n====================\n"}
          {err.name}: {err.message}
          {"\n\n"}
          {err.stack || ""}
        </div>
      );
    }
    return this.props.children;
  }
}
