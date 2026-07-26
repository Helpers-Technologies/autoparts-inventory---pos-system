import { useToast } from './Toast';
import { Info } from 'lucide-react';
﻿import {
  forwardRef,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

const HINT_TOOLTIP_WIDTH = 256;

function isZeroLikeInputValue(value: InputHTMLAttributes<HTMLInputElement>["value"]) {
  if (value === 0) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed !== "" && Number(trimmed) === 0;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  (
    {
      className,
      type,
      value,
      placeholder,
      onChange,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) => {
    const isControlledNumber = type === "number" && value !== undefined;
    const [draftValue, setDraftValue] = useState<string | null>(null);
    const showZeroAsPlaceholder = isControlledNumber && isZeroLikeInputValue(value);
    const inputValue =
      isControlledNumber && draftValue !== null
        ? draftValue
        : showZeroAsPlaceholder
        ? ""
        : value;

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
      if (isControlledNumber) setDraftValue(event.target.value);
      onChange?.(event);
    }

    function handleFocus(event: FocusEvent<HTMLInputElement>) {
      if (isControlledNumber) {
        setDraftValue(showZeroAsPlaceholder ? "" : String(value ?? ""));
      }
      onFocus?.(event);
    }

    function handleBlur(event: FocusEvent<HTMLInputElement>) {
      if (isControlledNumber) setDraftValue(null);
      onBlur?.(event);
    }

    return (
      <input
        ref={ref}
        type={type}
        value={inputValue}
        placeholder={showZeroAsPlaceholder ? placeholder ?? "0" : placeholder}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          "w-full h-9 px-3 text-sm rounded-lg border border-line bg-surface text-ink text-center",
          "placeholder:text-ink-faint",
          "focus-ring",
          "disabled:bg-surface-muted disabled:text-ink-faint",
          type === "number" && "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full min-h-[80px] px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink",
      "placeholder:text-ink-faint focus-ring",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "w-full h-9 px-3 text-sm rounded-lg border border-line bg-surface text-ink text-center [text-align-last:center] cursor-pointer shadow-sm transition-colors hover:border-brand-400/50",
      "focus-ring",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function HintIcon({ hint, label }: { hint: string; label?: React.ReactNode }) {
  let toast: any = null;
  try {
    toast = useToast();
  } catch (e) {
    // Safe fallback if used outside of ToastProvider
  }

  const hintBtnRef = useRef<HTMLButtonElement>(null);
  const [hoverPos, setHoverPos] = useState<{ top: number; left: number } | null>(null);

  const handleIconClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (toast) {
      toast.info(typeof label === "string" ? label : "معلومات", hint);
    } else {
      alert(hint);
    }
  };

  const showHoverHint = () => {
    const rect = hintBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const centerX = rect.left + rect.width / 2;
    const left = Math.min(
      Math.max(centerX - HINT_TOOLTIP_WIDTH / 2, 8),
      window.innerWidth - HINT_TOOLTIP_WIDTH - 8
    );
    setHoverPos({ top: rect.bottom + 8, left });
  };

  return (
    <>
      <button
        ref={hintBtnRef}
        type="button"
        onClick={handleIconClick}
        onMouseEnter={showHoverHint}
        onMouseLeave={() => setHoverPos(null)}
        className="cursor-help text-brand-500 hover:text-brand-400 transition-colors flex items-center p-0.5 focus:outline-none rounded"
      >
        <Info className="w-4 h-4" />
      </button>
      {hoverPos
        ? createPortal(
            <div
              dir="rtl"
              className="fixed z-[99999] p-3.5 rounded-xl border border-slate-700 bg-slate-900/95 dark:bg-slate-900/95 text-slate-100 text-xs shadow-2xl leading-relaxed text-right whitespace-pre-line pointer-events-none backdrop-blur-md"
              style={{ top: hoverPos.top, left: hoverPos.left, width: Math.min(320, window.innerWidth - 32) }}
            >
              {hint}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
  className,
}: {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
          <span>{label}</span>
          {required ? <span className="text-red-500">*</span> : null}
          {hint ? <HintIcon hint={hint} label={label} /> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
      ) : null}
    </div>
  );
}
