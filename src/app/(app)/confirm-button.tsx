"use client";
import { useTransition } from "react";

export function ConfirmButton({ action, label, confirm: msg, className }: { action: () => Promise<void>; label: string; confirm: string; className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        if (window.confirm(msg)) start(() => action());
      }}
    >
      {pending ? "…" : label}
    </button>
  );
}
