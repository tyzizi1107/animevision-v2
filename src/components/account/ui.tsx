"use client";

import { cn } from "@/lib/utils";

export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-3xl border border-line bg-gradient-to-br from-[#141319]/95 via-[#121116]/95 to-[#0d0c11]/95 p-5 shadow-[0_24px_70px_-55px_rgba(0,0,0,0.95)] sm:p-6", className)}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/90">{label}</p>
        {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200",
          checked
            ? "border-transparent bg-brand"
            : "border-line bg-white/10",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all duration-200",
            checked ? "left-[22px]" : "left-0.5",
          )}
          style={{ height: "18px", width: "18px" }}
        />
      </button>
    </div>
  );
}

export type StatusMessage = { type: "success" | "error"; message: string } | null;

export function Alert({ status }: { status: StatusMessage }) {
  if (!status) return null;
  return (
    <div
      role={status.type === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        status.type === "error"
          ? "border-red-400/30 bg-red-500/10 text-red-200"
          : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
      )}
    >
      {status.message}
    </div>
  );
}

export function SaveButton({
  busy,
  children = "Enregistrer",
  disabled,
}: {
  busy: boolean;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-5 text-sm font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? "Enregistrement…" : children}
    </button>
  );
}

export function AccountInput({
  hasError,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return (
    <input
      {...props}
      className={cn(
        "h-11 w-full rounded-xl border bg-white/[0.04] px-4 text-sm text-ink placeholder:text-muted/50 transition focus:bg-white/[0.07] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        hasError ? "border-red-400/60 focus:border-red-400" : "border-line focus:border-brand/60",
        className,
      )}
    />
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-white/75">{children}</span>;
}
