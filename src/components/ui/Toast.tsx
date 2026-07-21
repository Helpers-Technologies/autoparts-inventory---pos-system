import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { cn } from "../../lib/utils";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastCtx {
  toast: (t: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    const toast: Toast = { ...t, id };
    setItems((arr) => [toast, ...arr].slice(0, 5));
    setTimeout(() => {
      setItems((arr) => arr.filter((x) => x.id !== id));
    }, 3800);
  }, []);

  const value: ToastCtx = {
    toast: push,
    success: (title, description) => push({ type: "success", title, description }),
    error: (title, description) => push({ type: "error", title, description }),
    info: (title, description) => push({ type: "info", title, description }),
    warning: (title, description) => push({ type: "warning", title, description }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed top-4 left-4 z-[100] flex flex-col gap-2 items-start max-w-sm">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "animate-fadeIn flex items-start gap-3 w-full",
              "bg-surface rounded-lg shadow-lg border border-line p-3 pe-8 relative"
            )}
          >
            <div
              className={cn(
                "mt-0.5",
                t.type === "success" && "text-emerald-600 dark:text-emerald-400",
                t.type === "error" && "text-red-600 dark:text-red-400",
                t.type === "warning" && "text-amber-600 dark:text-amber-400",
                t.type === "info" && "text-blue-600 dark:text-blue-400"
              )}
            >
              {t.type === "success" ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : t.type === "error" ? (
                <XCircle className="w-5 h-5" />
              ) : t.type === "warning" ? (
                <AlertTriangle className="w-5 h-5" />
              ) : (
                <Info className="w-5 h-5" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink">{t.title}</div>
              {t.description ? (
                <div className="text-xs text-ink-muted mt-0.5">
                  {t.description}
                </div>
              ) : null}
            </div>
            <button
              className="absolute top-1.5 end-1.5 p-1 text-ink-faint hover:text-ink-muted"
              onClick={() => setItems((arr) => arr.filter((x) => x.id !== t.id))}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
