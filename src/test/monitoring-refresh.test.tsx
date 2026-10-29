import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProxyMonitoring from "@/components/admin/ProxyMonitoring";

const backend = vi.hoisted(() => ({ calls: [] as string[], fail: false }));

vi.mock("@/lib/supabaseLocal", () => ({
  supabase: {
    from: (table: string) => {
      backend.calls.push(table);
      const response = { data: [], error: backend.fail ? new Error("Unavailable") : null };
      const query: Record<string, unknown> = {
        then: (resolve: (value: typeof response) => unknown) => Promise.resolve(response).then(resolve),
      };
      for (const method of ["select", "gte", "order", "limit", "is", "range"]) query[method] = () => query;
      return query;
    },
    rpc: async () => {
      backend.calls.push("get_monitoring_stats_30d");
      return { data: [{ unique_ips: 0 }], error: null };
    },
  },
}));

let client: QueryClient;
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
  });
};

const openMonitoring = async () => {
  client = new QueryClient();
  render(<QueryClientProvider client={client}><ProxyMonitoring /></QueryClientProvider>);
  await settle();
};

beforeEach(() => {
  vi.useFakeTimers();
  backend.calls = [];
  backend.fail = false;
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});

afterEach(() => {
  cleanup();
  client?.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("manual monitoring refresh", () => {
  it("loads all four monitoring queries on entry and refetches them when Atualizar is clicked", async () => {
    await openMonitoring();
    expect(backend.calls).toEqual(["proxy_access_log", "profiles", "user_sessions", "get_monitoring_stats_30d", "user_sessions"]);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();
    await settle();
    expect(backend.calls).toHaveLength(10);
    expect(backend.calls.slice(5)).toEqual(backend.calls.slice(0, 5));
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled();
  });

  it("does not poll after 60 seconds, beyond the previous 10-second and 30-second intervals", async () => {
    await openMonitoring();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(backend.calls).toHaveLength(5);
  });

  it("does not fetch when focus returns or the connection is restored", async () => {
    await openMonitoring();
    await act(async () => {
      focusManager.setFocused(false);
      onlineManager.setOnline(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(true);
    });
    await settle();
    expect(backend.calls).toHaveLength(5);
  });

  it("does not retry failures automatically and allows a manual retry", async () => {
    await openMonitoring();
    backend.fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await settle();
    const failedCalls = backend.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(backend.calls).toHaveLength(failedCalls);
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled();
    backend.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await settle();
    expect(backend.calls.length).toBe(failedCalls + 5);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});