import { useToast } from './Toast';
import { Info } from 'lucide-react';
﻿import {
  forwardRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../../lib/utils";

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
      "w-full h-9 px-3 text-sm rounded-lg border border-line bg-surface text-ink text-center [text-align-last:center]",
      "focus-ring",
      className
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Field({
  label,
  hint,
  error,
  children,
  required,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  let toast: any = null;
  try {
    toast = useToast();
  } catch (e) {
    // Safe fallback if used outside of ToastProvider
  }

  const handleIconClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (hint) {
      if (toast) {
        toast.info(label || "معلومات", hint);
      } else {
        alert(hint);
      }
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
          <span>{label}</span>
          {required ? <span className="text-red-500">*</span> : null}
          {hint ? (
            <button
              type="button"
              title={hint}
              onClick={handleIconClick}
              className="cursor-help text-ink-faint hover:text-ink transition-colors flex items-center p-0.5 focus:outline-none rounded hover:bg-surface-muted"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <div className="text-xs text-red-600 dark:text-red-400">{error}</div>
      ) : null}
    </div>
  );
}
