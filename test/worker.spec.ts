import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Cloudflare edge", () => {
  it("serves the mobile frontend with security headers", async () => {
    const response = await SELF.fetch("https://remote-code-agent.test/");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("Remote Code");
  });

  it("requires a valid Access identity before proxying", async () => {
    const response = await SELF.fetch("https://remote-code-agent.test/healthz");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Cloudflare Access authentication required",
    });
  });

  it("protects file uploads with the same Access identity check", async () => {
    const response = await SELF.fetch(
      "https://remote-code-agent.test/api/upload?session=main&name=notes.txt",
      { method: "PUT", body: "private notes" },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Cloudflare Access authentication required",
    });
  });

  it("requires a WebSocket upgrade on the terminal route", async () => {
    const response = await SELF.fetch("http://localhost/ws");

    expect(response.status).toBe(426);
  });
});
