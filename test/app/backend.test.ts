import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { BackendApi } from "../../src/app/backend.js";

test("server-scoped endpoints fall back only on a 404", async () => {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url || "");
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/v2/launcher/servers/eu/status") {
      res.statusCode = 404;
      return res.end('{"error":"missing"}');
    }
    if (req.url === "/api/v2/launcher/status")
      return res.end('{"status":"online"}');
    res.statusCode = 500;
    res.end('{"error":"unexpected"}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const api = new BackendApi(
      `http://127.0.0.1:${(server.address() as any).port}`,
      "/api/v2",
    );
    assert.deepEqual(await api.status("eu"), { status: "online" });
    assert.deepEqual(requests, [
      "/api/v2/launcher/servers/eu/status",
      "/api/v2/launcher/status",
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
