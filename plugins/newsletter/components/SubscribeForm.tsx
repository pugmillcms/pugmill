"use client";
import { useState } from "react";
import { subscribeNewsletter } from "../actions";

interface Props {
  label: string;
  description: string;
}

export default function SubscribeForm({ label, description }: Props) {
  const [state, setState] = useState<"idle" | "pending" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("pending");
    setError(null);
    const fd = new FormData(e.currentTarget);
    const result = await subscribeNewsletter(fd);
    if (result.ok) {
      setState("ok");
    } else {
      setState("error");
      setError(result.error ?? "Something went wrong.");
    }
  }

  if (state === "ok") {
    return (
      <div className="border-t pt-8 mt-8" style={{ borderColor: "var(--color-border)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--color-foreground)" }}>
          You&apos;re subscribed. New posts will be delivered to your inbox.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t pt-8 mt-8" style={{ borderColor: "var(--color-border)" }}>
      <p className="text-sm font-semibold mb-0.5" style={{ color: "var(--color-foreground)" }}>
        {label}
      </p>
      {description && (
        <p className="text-sm mb-3" style={{ color: "var(--color-muted)" }}>
          {description}
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 max-w-md">
        {/* Honeypot — hidden from humans, tempting to bots. */}
        <input
          type="text"
          name="_hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
          style={{ display: "none" }}
        />
        <input
          name="email"
          type="email"
          required
          placeholder="your@email.com"
          className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-400"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-foreground)" }}
        />
        <button
          type="submit"
          disabled={state === "pending"}
          className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          style={{ background: "var(--color-foreground)", color: "var(--color-background)" }}
        >
          {state === "pending" ? "Subscribing…" : "Subscribe"}
        </button>
      </form>
      {state === "error" && (
        <p className="text-xs mt-2" style={{ color: "var(--color-danger, #ef4444)" }}>{error}</p>
      )}
    </div>
  );
}
