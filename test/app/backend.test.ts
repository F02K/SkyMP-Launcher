import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { BackendApi } from "../../src/app/backend.js";

test("server-scoped endpoints use the fixed unversioned API and bearer sessions", async () => {
  const requests: Array<{ url: string; authorization?: string }> = [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url || "",
      authorization: req.headers.authorization,
    });
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/launcher/servers/eu/status")
      return res.end('{"status":"online"}');
    if (req.url === "/api/launcher/servers/eu") return res.end('{"name":"EU"}');
    res.statusCode = 404;
    res.end('{"error":{"code":"notFound","message":"missing"}}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const api = new BackendApi(
      `http://127.0.0.1:${(server.address() as any).port}`,
    );
    assert.deepEqual(await api.status("eu"), { status: "online" });
    assert.deepEqual(await api.serverInfo("eu", "server-session"), {
      name: "EU",
    });
    assert.deepEqual(requests, [
      {
        url: "/api/launcher/servers/eu/status",
        authorization: undefined,
      },
      {
        url: "/api/launcher/servers/eu",
        authorization: "Bearer server-session",
      },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
