import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { serverSchema } from "./schemas.js";
import type { Server } from "./types.js";

interface DirectoryOptions {
  url: string;
  publicKey: string;
  filters?: Record<string, string>;
}

export class DirectoryError extends Error {
  constructor(
    message: string,
    public statusCode = 0,
    public body?: any,
  ) {
    super(message);
  }
}

export class DirectoryApi {
  private readonly url: string;
  private readonly publicKey: crypto.KeyObject;
  constructor(private readonly options: DirectoryOptions) {
    this.url = options.url.replace(/\/$/, "");
    if (!this.url) throw new Error("Directory URL is required.");
    this.publicKey = options.publicKey.includes("BEGIN PUBLIC KEY")
      ? crypto.createPublicKey(options.publicKey)
      : crypto.createPublicKey({
          key: Buffer.from(options.publicKey, "base64"),
          format: "der",
          type: "spki",
        });
  }

  async servers(signal?: AbortSignal): Promise<Server[]> {
    const query = new URLSearchParams(
      Object.entries(this.options.filters || {}).filter(([, value]) => value),
    );
    const value = await this.signed(`/api/servers?${query}`, signal);
    if (!Array.isArray(value?.items))
      throw new DirectoryError("Directory catalog has no items array.");
    return value.items.map((item: any) => this.map(item));
  }

  async resolveJoin(code: string, signal?: AbortSignal): Promise<Server> {
    if (!/^[A-Za-z0-9._~-]{3,200}$/.test(code))
      throw new DirectoryError("Invalid join code.");
    return this.map(
      await this.signed(`/api/join/${encodeURIComponent(code)}`, signal),
    );
  }

  authStart() {
    return this.request("POST", "/api/auth/discord/start");
  }
  authStatus(flowId: string, pollToken: string) {
    return this.request(
      "GET",
      `/api/auth/discord/status/${encodeURIComponent(flowId)}`,
      undefined,
      pollToken,
    );
  }
  session(sessionToken: string) {
    return this.request("GET", "/api/auth/session", undefined, sessionToken);
  }
  revokeSession(sessionToken: string) {
    return this.request("DELETE", "/api/auth/session", undefined, sessionToken);
  }
  playGrant(serverId: string, sessionToken: string) {
    return this.request(
      "POST",
      `/api/servers/${encodeURIComponent(serverId)}/play-grants`,
      {},
      sessionToken,
    );
  }

  private map(item: any): Server {
    if (
      !item?.serverId ||
      !item?.descriptor ||
      item.descriptor.contract !== "directory-managed"
    )
      throw new DirectoryError("Invalid server descriptor.");
    const gameAddress = String(item.descriptor.gameAddress || "");
    const ipv6 = gameAddress.match(/^\[([^\]]+)]:(\d+)$/);
    const separator = gameAddress.lastIndexOf(":");
    const address =
      ipv6?.[1] || (separator > 0 ? gameAddress.slice(0, separator) : "");
    const port = Number(
      ipv6?.[2] || (separator > 0 ? gameAddress.slice(separator + 1) : 0),
    );
    return serverSchema.parse({
      key: item.serverId,
      contract: item.descriptor.contract,
      name: item.descriptor.name,
      address,
      port,
      backendUrl: item.descriptor.publicBackendUrl,
      description: item.descriptor.description || "",
      status: item.status,
      region: item.descriptor.region,
      tags: item.descriptor.tags,
      versions: item.descriptor.versions,
      visibility: item.descriptor.visibility || "public",
      lastHeartbeatAt: Number(item.lastHeartbeatAt || 0),
      source:
        item.descriptor.visibility === "private" ? "private" : "directory",
      stale: false,
      listed: true,
      access: item.descriptor.access,
    });
  }

  private signed(pathname: string, signal?: AbortSignal): Promise<any> {
    const url = `${this.url}${pathname}`;
    return new Promise((resolve, reject) => {
      const transport = url.startsWith("https:") ? https : http;
      const request = transport.get(url, { signal }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 5 * 1024 * 1024)
            request.destroy(
              new DirectoryError("Directory response exceeds 5 MiB."),
            );
          else chunks.push(Buffer.from(chunk));
        });
        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          )
            return reject(
              new DirectoryError(
                `Directory returned HTTP ${response.statusCode}`,
                response.statusCode || 0,
              ),
            );
          const signature = response.headers["x-skymp-signature"];
          if (
            typeof signature !== "string" ||
            !crypto.verify(
              null,
              raw,
              this.publicKey,
              Buffer.from(signature, "base64url"),
            )
          )
            return reject(
              new DirectoryError("Directory signature is invalid."),
            );
          try {
            resolve(JSON.parse(raw.toString("utf8")));
          } catch {
            reject(new DirectoryError("Directory returned invalid JSON."));
          }
        });
      });
      request.on("error", reject);
      request.setTimeout(10_000, () =>
        request.destroy(new DirectoryError("Directory request timed out.")),
      );
    });
  }

  private request(
    method: "GET" | "POST" | "DELETE",
    pathname: string,
    value?: unknown,
    bearer?: string,
  ): Promise<any> {
    const url = `${this.url}${pathname}`;
    return new Promise((resolve, reject) => {
      const transport = url.startsWith("https:") ? https : http;
      const raw = value === undefined ? "" : JSON.stringify(value);
      const request = transport.request(
        url,
        {
          method,
          headers: {
            accept: "application/json",
            ...(raw
              ? {
                  "content-type": "application/json",
                  "content-length": Buffer.byteLength(raw).toString(),
                }
              : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
        },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024)
              request.destroy(
                new DirectoryError("Directory response exceeds 1 MiB."),
              );
          });
          response.on("end", () => {
            let parsed: any;
            try {
              parsed = body ? JSON.parse(body) : null;
            } catch {
              return reject(
                new DirectoryError(
                  "Directory returned invalid JSON.",
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
                new DirectoryError(
                  parsed?.error?.message ||
                    `Directory returned HTTP ${response.statusCode}`,
                  response.statusCode || 0,
                  parsed,
                ),
              );
            resolve(parsed);
          });
        },
      );
      request.on("error", reject);
      request.setTimeout(10_000, () =>
        request.destroy(new DirectoryError("Directory request timed out.")),
      );
      if (raw) request.write(raw);
      request.end();
    });
  }
}

export function joinCodeFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "skymp:" || url.hostname !== "join") return null;
    const code = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return /^[A-Za-z0-9._~-]{3,200}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
