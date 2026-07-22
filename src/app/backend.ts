import http from "node:http";
import https from "node:https";
import { clientManifestSchema, serverSchema } from "./schemas.js";
import type { ClientManifest, Server } from "./types.js";

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
  readonly v2Url: string;
  constructor(
    readonly baseUrl: string,
    apiBasePath = "/api/v2",
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.v2Url = `${this.baseUrl}${apiBasePath.replace(/\/$/, "")}`;
  }

  url(pathname: string): string {
    return `${this.v2Url}${pathname}`;
  }
  scoped(key: string, suffix = ""): string {
    return `/launcher/servers/${encodeURIComponent(key)}${suffix}`;
  }

  async servers(signal?: AbortSignal): Promise<Server[]> {
    const value = await this.request("/launcher/servers", {}, signal);
    return (Array.isArray(value?.items) ? value.items : []).map(
      (item: unknown) => serverSchema.parse(item),
    );
  }

  async scopedOrLegacy(
    key: string,
    suffix: string,
    legacy: string,
    headers: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<any> {
    try {
      return await this.request(this.scoped(key, suffix), headers, signal);
    } catch (error) {
      if (!(error instanceof BackendError) || error.statusCode !== 404)
        throw error;
      return this.request(legacy, headers, signal);
    }
  }

  status(key: string, signal?: AbortSignal) {
    return this.scopedOrLegacy(key, "/status", "/launcher/status", {}, signal);
  }
  serverInfo(key: string, session?: string, signal?: AbortSignal) {
    return this.scopedOrLegacy(
      key,
      "",
      "/launcher/servers/default",
      session ? { "x-session": session } : {},
      signal,
    );
  }
  async news(key: string, signal?: AbortSignal) {
    const value = await this.scopedOrLegacy(
      key,
      "/news",
      "/launcher/news",
      {},
      signal,
    );
    return Array.isArray(value?.items) ? value.items : [];
  }
  async mods(key: string, signal?: AbortSignal) {
    const value = await this.scopedOrLegacy(
      key,
      "/mods",
      "/launcher/mods",
      {},
      signal,
    );
    return Array.isArray(value?.items) ? value.items : [];
  }
  metrics(key: string, signal?: AbortSignal) {
    return this.scopedOrLegacy(
      key,
      "/metrics",
      "/launcher/metrics",
      {},
      signal,
    );
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
  discordStartUrl(state: string) {
    return this.url(`/auth/discord/start?state=${encodeURIComponent(state)}`);
  }
  async discordStatus(state: string) {
    return this.request(
      `/auth/discord/status?state=${encodeURIComponent(state)}`,
    );
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
}
