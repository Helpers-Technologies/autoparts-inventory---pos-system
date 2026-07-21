import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Global error boundary that catches rendering errors and shows a
 * recovery UI instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to the console so it can be seen in devtools / the main process log
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          dir="rtl"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f8fafc",
            fontFamily: "Tahoma, Arial, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: 480,
              padding: 32,
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2 style={{ margin: "0 0 8px", color: "#1e293b", fontSize: 20 }}>
              حدث خطأ غير متوقع
            </h2>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
              حصل مشكلة أثناء تحميل الصفحة. جرّب تعيد المحاولة أو تعمل إعادة تحميل للتطبيق.
            </p>
            {this.state.error && (
              <details
                style={{
                  textAlign: "left",
                  direction: "ltr",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: "8px 12px",
                  marginBottom: 20,
                  fontSize: 12,
                  color: "#991b1b",
                  maxHeight: 120,
                  overflow: "auto",
                }}
              >
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  Error details
                </summary>
                <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
                  {this.state.error.message}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={this.handleRetry}
                style={{
                  padding: "10px 24px",
                  background: "#241f62",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                إعادة المحاولة
              </button>
              <button
                onClick={this.handleReload}
                style={{
                  padding: "10px 24px",
                  background: "#e2e8f0",
                  color: "#334155",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                إعادة تحميل
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
