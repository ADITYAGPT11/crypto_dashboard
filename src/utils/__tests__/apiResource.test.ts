import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiResource } from "../../services/ApiResource";
import { ApiError, apiGet, apiUrl } from "../../api/client";

afterEach(() => {
  vi.useRealTimers();
});

describe("ApiResource", () => {
  it("fetches once per key for any number of subscribers and refreshes on schedule", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const res = new ApiResource<number>({
      fetch: async () => ++calls,
      refreshIn: () => 60_000,
    });
    const off1 = res.subscribe("k", () => {});
    const off2 = res.subscribe("k", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(res.get("k").data).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(2);
    off1();
    off2();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toBe(2); // nobody listening: no more requests
  });

  it("keeps the last data on an error and retries", async () => {
    vi.useFakeTimers();
    let fail = false;
    const res = new ApiResource<string>({
      fetch: async () => {
        if (fail) throw new Error("offline");
        return "ok";
      },
      refreshIn: () => 1_000,
    });
    res.subscribe("k", () => {});
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(res.get("k")).toMatchObject({ data: "ok", error: "offline" });
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(res.get("k")).toMatchObject({ data: "ok", error: null });
  });
});

describe("api client", () => {
  it("builds versioned URLs without empty params", () => {
    expect(apiUrl("/stats", { tf: "4h", zoneTf: undefined, x: "" })).toBe("/api/v1/stats?tf=4h");
  });

  it("explains an unreachable service and keeps the API's own error text", async () => {
    await expect(
      apiGet("/x", {}, async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toMatchObject({ status: null });
    const proxyDown = async () => new Response("proxy error", { status: 502 });
    await expect(apiGet("/x", {}, proxyDown)).rejects.toThrow(/npm start/);
    const bad = async () =>
      new Response(JSON.stringify({ detail: "unknown pattern" }), { status: 422 });
    const err = await apiGet("/x", {}, bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("unknown pattern");
  });
});
