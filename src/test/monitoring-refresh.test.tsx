import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProxyMonitoring from "@/components/admin/ProxyMonitoring";

const backend = vi.hoisted(() => ({
  calls: [] as string[], fail: false,
  queries: [] as { table: string; filters: Record<string, unknown> }[],
  sessions: [] as Record<string, unknown>[],
  logs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabaseLocal", () => ({
  supabase: {
    from: (table: string) => {
      backend.calls.push(table);
      const filters: Record<string, unknown> = {};
      backend.queries.push({ table, filters });
      const rows = table === "user_sessions" ? backend.sessions : table === "proxy_access_log" ? backend.logs : [];
      const query: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: rows.filter(row => Object.entries(filters).every(([key, value]) =>
            key === "ended_at" ? row[key] === value : String(row[key]) >= String(value))),
          error: backend.fail ? new Error("Unavailable") : null,
        }).then(resolve),
      };
      for (const method of ["select", "order", "limit"]) query[method] = () => query;
      for (const method of ["gte", "is"]) query[method] = (column: string, value: unknown) => {
        filters[column] = value;
        return query;
      };
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
  backend.queries = [];
  backend.sessions = [];
  backend.logs = [];
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
    expect(backend.calls).toEqual(["proxy_access_log", "profiles", "user_sessions", "user_sessions"]);
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeDisabled();
    await settle();
    expect(backend.calls).toHaveLength(8);
    expect(backend.calls.slice(4)).toEqual(backend.calls.slice(0, 4));
    expect(screen.getByRole("button", { name: "Atualizar" })).toBeEnabled();
  });

  it("does not poll after 60 seconds, beyond the previous 10-second and 30-second intervals", async () => {
    await openMonitoring();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(backend.calls).toHaveLength(4);
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
    expect(backend.calls).toHaveLength(4);
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
    expect(backend.calls.length).toBe(failedCalls + 4);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("queries only unfinished sessions from the last 90 seconds, including IP enrichment", async () => {
    const now = Date.now();
    await openMonitoring();
    const queries = backend.queries.filter(q => q.table === "user_sessions");
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(q.filters).toEqual({ ended_at: null, last_heartbeat_at: new Date(now - 90_000).toISOString() });
    }
    expect(backend.calls).not.toContain("get_monitoring_stats_30d");
  });

  it("queries proxy accesses from the last 3 minutes and advances the cutoff on manual refresh", async () => {
    const now = Date.now();
    await openMonitoring();
    expect(backend.queries[0].filters.last_seen_at).toBe(new Date(now - 180_000).toISOString());
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    const refreshedAt = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await settle();
    expect(backend.queries[4].filters.last_seen_at).toBe(new Date(refreshedAt - 180_000).toISOString());
  });

  it("shows a live viewer but excludes expired and ended sessions from the online result", async () => {
    const now = Date.now();
    backend.sessions = [
      { id: "live", user_id: "live-user", current_channel_name: "Canal atual", is_watching: true, ended_at: null, last_heartbeat_at: new Date(now - 30_000).toISOString() },
      { id: "expired", user_id: "expired-user", current_channel_name: "Canal expirado", is_watching: true, ended_at: null, last_heartbeat_at: new Date(now - 91_000).toISOString() },
      { id: "ended", user_id: "ended-user", current_channel_name: "Canal encerrado", is_watching: true, ended_at: new Date(now).toISOString(), last_heartbeat_at: new Date(now - 10_000).toISOString() },
    ];
    await openMonitoring();
    expect(screen.getByText("Canal atual")).toBeInTheDocument();
    expect(screen.queryByText("Canal expirado")).not.toBeInTheDocument();
    expect(screen.queryByText("Canal encerrado")).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await settle();
    expect(screen.queryByText("Canal atual")).not.toBeInTheDocument();
  });

  it("requires a proxy hit for the current user and channel within 3 minutes", async () => {
    const now = Date.now();
    backend.sessions = [
      { id: "live", user_id: "live-user", current_channel_name: "Canal atual", is_watching: true, ended_at: null, last_heartbeat_at: new Date(now - 30_000).toISOString() },
    ];
    const log = { id: "hit", user_id: "live-user", channel_name: "Canal atual", request_count: 1, bytes_transferred: 0, first_seen_at: new Date(now - 60_000).toISOString(), last_seen_at: new Date(now - 60_000).toISOString() };
    backend.logs = [log];
    await openMonitoring();
    fireEvent.click(screen.getByRole("button", { name: /No proxy agora/ }));
    expect(screen.getByRole("heading", { name: "Ativos no proxy agora (1)" })).toBeInTheDocument();

    for (const hit of [
      { ...log, channel_name: "Outro canal" },
      { ...log, user_id: "outro-user" },
      { ...log, last_seen_at: new Date(now - 181_000).toISOString() },
    ]) {
      backend.logs = [hit];
      await act(async () => { await client.refetchQueries(); });
      await settle();
      expect(screen.getByRole("heading", { name: "Ativos no proxy agora (0)" })).toBeInTheDocument();
    }
  });
});