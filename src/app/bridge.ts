import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { NexusStatus } from "./types.js";

export type BridgeEvent = {
  id?: string;
  event:
    | "progress"
    | "manualDownload"
    | "authRequired"
    | "premiumStatus"
    | "complete"
    | "error";
  message?: string;
  percent?: number;
  url?: string;
  fileName?: string;
  size?: number;
  sha256?: string;
  result?: unknown;
  error?: string;
};

export function decodeBridgeLine(line: string): BridgeEvent {
  const value = JSON.parse(line) as BridgeEvent;
  if (!value || typeof value !== "object" || typeof value.event !== "string")
    throw new Error("Invalid installer bridge event.");
  const allowed = new Set([
    "progress",
    "manualDownload",
    "authRequired",
    "premiumStatus",
    "complete",
    "error",
  ]);
  if (!allowed.has(value.event))
    throw new Error(`Unknown installer bridge event: ${value.event}`);
  return value;
}

export class InstallerBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private sequence = 0;
  private pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();

  constructor(
    private executable: string,
    private wabbajack: string,
    private onEvent: (event: BridgeEvent) => Promise<void> | void,
  ) {}

  private start() {
    if (this.child) return;
    const child = spawn(this.executable, ["--wabbajack", this.wabbajack], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      void this.receive(line);
    });
    child.stderr.on("data", () => undefined);
    child.once("error", (error) => this.failAll(error));
    child.once("exit", (code) => {
      this.failAll(
        new Error(`Installer bridge stopped unexpectedly (${code}).`),
      );
      this.child = null;
    });
  }

  private async receive(line: string) {
    let event: BridgeEvent;
    try {
      if (Buffer.byteLength(line) > 1024 * 1024)
        throw new Error("Installer bridge event exceeds 1 MiB.");
      event = decodeBridgeLine(line);
    } catch (error) {
      this.failAll(error as Error);
      return;
    }
    const pending = event.id ? this.pending.get(event.id) : undefined;
    if (event.event === "complete" && pending) {
      this.pending.delete(event.id!);
      pending.resolve(event.result);
      return;
    }
    if (event.event === "error" && pending) {
      this.pending.delete(event.id!);
      pending.reject(
        new Error(event.error || event.message || "Bridge error."),
      );
      return;
    }
    try {
      await this.onEvent(event);
    } catch (error) {
      if (event.id) this.pending.delete(event.id);
      pending?.reject(error as Error);
    }
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  command<T = unknown>(command: string, payload: Record<string, unknown> = {}) {
    this.start();
    const id = String(++this.sequence);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(
        `${JSON.stringify({ id, command, ...payload })}\n`,
      );
    });
  }

  authStatus() {
    return this.command<NexusStatus>("auth.status");
  }
  authLogin() {
    return this.command<NexusStatus>("auth.login");
  }
  inspect(modlist: string) {
    return this.command("inspect", { modlist });
  }
  install(payload: Record<string, unknown>) {
    return this.command("install", payload);
  }
  verify(payload: Record<string, unknown>) {
    return this.command<{ valid: boolean; problems?: string[] }>(
      "verify",
      payload,
    );
  }
  async cancel() {
    if (!this.child) return false;
    await Promise.race([
      this.command("cancel"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (this.child) this.child.kill();
    return true;
  }
  respondToManualDownload(requestId: string, file: string) {
    return this.command("manualDownload.complete", { requestId, file });
  }
  close() {
    this.child?.kill();
    this.child = null;
  }
}
