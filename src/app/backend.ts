import http from "node:http";
import https from "node:https";
import { clientManifestSchema, modpackManifestSchema } from "./schemas.js";
import type { ClientManifest, ModpackManifest } from "./types.js";

export class BackendError extends Error {
  constructor(
    message: string,
    public statusCode = 0,
    public body?: unknown,
  ) {
    super(message);
  }
}

export class BackendApi {
  readonly apiUrl: string;
  constructor(readonly baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiUrl = `${this.baseUrl}/api`;
  }

  url(pathname: string): string {
    return `${this.apiUrl}${pathname}`;
  }
  scoped(key: string, suffix = ""): string {
    return `/launcher/servers/${encodeURIComponent(key)}${suffix}`;
  }

  status(key: string, signal?: AbortSignal) {
    return this.request(this.scoped(key, "/status"), {}, signal);
  }
  serverInfo(key: string, session?: string, signal?: AbortSignal) {
    return this.request(
      this.scoped(key),
      session ? { authorization: `Bearer ${session}` } : {},
      signal,
    );
  }
  async news(key: string, signal?: AbortSignal) {
    const value = await this.request(this.scoped(key, "/news"), {}, signal);
    return Array.isArray(value?.items) ? value.items : [];
  }
  async mods(key: string, signal?: AbortSignal) {
    const value = await this.request(this.scoped(key, "/mods"), {}, signal);
    return Array.isArray(value?.items) ? value.items : [];
  }
  metrics(key: string, signal?: AbortSignal) {
    return this.request(this.scoped(key, "/metrics"), {}, signal);
  }
  async manifest(key: string, signal?: AbortSignal): Promise<ClientManifest> {
    const value = await this.request(
      this.scoped(key, "/client/manifest"),
      {},
      signal,
    );
    return clientManifestSchema.parse(value) as ClientManifest;
  }
  clientDownloadUrl(key: string) {
    return this.url(this.scoped(key, "/client/download"));
  }
  async modpackManifest(
    key: string,
    signal?: AbortSignal,
  ): Promise<ModpackManifest> {
    const value = await this.request(
      this.scoped(key, "/modpack/manifest"),
      {},
      signal,
    );
    return modpackManifestSchema.parse(value) as ModpackManifest;
  }
  modpackDownloadUrl(key: string) {
    return this.url(this.scoped(key, "/modpack/download"));
  }
  exchangeDirectoryGrant(value: unknown) {
    return this.post("/auth/directory/exchange", value);
  }
  request(
    pathname: string,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<any> {
    const url = this.url(pathname);
    return new Promise((resolve, reject) => {
      const transport = url.startsWith("https:") ? https : http;
      const request = transport.get(url, { headers, signal }, (response) => {
        let body = "";
        let bytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 5 * 1024 * 1024)
            request.destroy(new BackendError("Backend response exceeds 5 MiB"));
          else body += chunk;
        });
        response.on("end", () => {
          let value: any;
          try {
            value = JSON.parse(body);
          } catch {
            return reject(
              new BackendError(
                `Invalid JSON from backend (${response.statusCode})`,
                response.statusCode || 0,
              ),
            );
          }
          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            return reject(
              new BackendError(
                value?.error?.message ||
                  value?.error ||
                  `HTTP ${response.statusCode}`,
                response.statusCode || 0,
                value,
              ),
            );
          }
          resolve(value);
        });
      });
      request.on("error", reject);
      request.setTimeout(10_000, () =>
        request.destroy(new BackendError("Backend request timed out")),
      );
    });
  }

  private post(pathname: string, value: unknown): Promise<any> {
    const url = this.url(pathname);
    const raw = JSON.stringify(value);
    return new Promise((resolve, reject) => {
      const transport = url.startsWith("https:") ? https : http;
      const request = transport.request(
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(raw),
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (body += chunk));
          response.on("end", () => {
            let result: any;
            try {
              result = body ? JSON.parse(body) : null;
            } catch {
              return reject(
                new BackendError(
                  "Invalid JSON from backend",
                  response.statusCode || 0,
                ),
              );
            }
            if (
              !response.statusCode ||
              response.statusCode < 200 ||
              response.statusCode >= 300
            )
              return reject(
                new BackendError(
                  result?.error?.message || `HTTP ${response.statusCode}`,
                  response.statusCode || 0,
                  result,
                ),
              );
            resolve(result);
          });
        },
      );
      request.on("error", reject);
      request.setTimeout(10_000, () =>
        request.destroy(new BackendError("Backend request timed out")),
      );
      request.end(raw);
    });
  }
}
