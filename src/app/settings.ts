import { safeStorage } from "electron";
import Store from "electron-store";
import type { DiscordUser, PublicSettings, Server } from "./types.js";

type StoreShape = {
  skyrimPath: string;
  activeServerKey: string;
  activeServerIndex?: number;
  cachedServers: Server[];
  favoriteServerKeys: string[];
  preferredServerKey: string;
  directoryStatus: "live" | "empty" | "stale" | "unavailable";
  directoryError: string;
  encryptedDirectorySession: string;
  encryptedServerSessions: Record<string, string>;
  serverProfileIds: Record<string, number>;
  encryptedPrivateJoinCodes: Record<string, string>;
  installedManifests: Record<string, unknown>;
  discordUser: DiscordUser | null;
  modpackLocations: Record<string, string>;
  modpackReceipts: Record<string, unknown>;
  locale: "en" | "de";
  onboardingVersion: number;
  launchAtLogin: boolean;
  closeBehavior: "exit" | "tray";
  afterLaunch: "keep" | "minimize" | "close";
  reduceMotion: boolean;
  lastCrash: string;
};

export class SettingsService {
  readonly store: Store<StoreShape>;
  private currentServerKey = "";
  constructor() {
    this.store = new Store<StoreShape>({
      defaults: {
        skyrimPath: "",
        activeServerKey: "",
        cachedServers: [],
        favoriteServerKeys: [],
        preferredServerKey: "",
        directoryStatus: "unavailable",
        directoryError: "",
        encryptedDirectorySession: "",
        encryptedServerSessions: {},
        serverProfileIds: {},
        encryptedPrivateJoinCodes: {},
        installedManifests: {},
        discordUser: null,
        modpackLocations: {},
        modpackReceipts: {},
        locale: "en",
        onboardingVersion: 0,
        launchAtLogin: false,
        closeBehavior: "exit",
        afterLaunch: "minimize",
        reduceMotion: false,
        lastCrash: "",
      },
    });
    this.migrateServerSelection();
  }

  private encrypt(value: string): string {
    if (!value || !safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.encryptString(value).toString("base64");
  }
  private decrypt(value: string): string {
    if (!value || !safeStorage.isEncryptionAvailable()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      return "";
    }
  }
  private migrateServerSelection() {
    const legacy = this.store.get("activeServerKey");
    const favorites = this.store.get("favoriteServerKeys");
    if (legacy && !favorites.includes(legacy)) {
      this.store.set("favoriteServerKeys", [...favorites, legacy]);
      this.store.set("preferredServerKey", legacy);
    }
    const preferred = this.store.get("preferredServerKey");
    this.currentServerKey = this.store
      .get("favoriteServerKeys")
      .includes(preferred)
      ? preferred
      : "";
    this.store.set("activeServerKey", "");
    this.store.delete("activeServerIndex");
  }
  getDirectorySession() {
    return this.decrypt(this.store.get("encryptedDirectorySession"));
  }
  setDirectorySession(value: string) {
    this.store.set("encryptedDirectorySession", this.encrypt(value));
  }
  clearDirectorySession() {
    this.store.set("encryptedDirectorySession", "");
  }
  getServerSession(key: string) {
    return this.decrypt(this.store.get("encryptedServerSessions")[key] || "");
  }
  setServerSession(key: string, value: string, profileId: number) {
    this.store.set("encryptedServerSessions", {
      ...this.store.get("encryptedServerSessions"),
      [key]: this.encrypt(value),
    });
    this.store.set("serverProfileIds", {
      ...this.store.get("serverProfileIds"),
      [key]: profileId,
    });
  }
  serverProfileId(key: string) {
    return this.store.get("serverProfileIds")[key] ?? null;
  }
  applyDirectoryCatalog(servers: Server[]) {
    const favorites = new Set(this.store.get("favoriteServerKeys"));
    const incoming = new Set(servers.map((server) => server.key));
    const preserved = this.store
      .get("cachedServers")
      .filter(
        (server) =>
          server.source === "private" ||
          (favorites.has(server.key) && !incoming.has(server.key)),
      )
      .map((server) =>
        incoming.has(server.key)
          ? server
          : {
              ...server,
              listed: false,
              stale: false,
              status: { ...server.status, state: "offline", online: 0 },
            },
      );
    this.store.set("cachedServers", [
      ...servers,
      ...preserved.filter((item) => !incoming.has(item.key)),
    ]);
    this.store.set("directoryStatus", servers.length ? "live" : "empty");
    this.store.set("directoryError", "");
  }
  markDirectoryUnavailable(message: string) {
    this.store.set(
      "cachedServers",
      this.store.get("cachedServers").map((server) =>
        server.source === "directory"
          ? {
              ...server,
              stale: true,
              status: { ...server.status, state: "offline", online: 0 },
            }
          : server,
      ),
    );
    this.store.set(
      "directoryStatus",
      this.store.get("cachedServers").length ? "stale" : "unavailable",
    );
    this.store.set("directoryError", message);
  }
  privateJoinEntries() {
    return Object.entries(this.store.get("encryptedPrivateJoinCodes"))
      .map(([key, value]) => ({ key, code: this.decrypt(value) }))
      .filter((item) => item.code);
  }
  addPrivateServer(server: Server, joinCode: string, open = true) {
    const servers = this.store
      .get("cachedServers")
      .filter((item) => item.key !== server.key);
    this.store.set("cachedServers", [
      ...servers,
      { ...server, source: "private", visibility: "private" },
    ]);
    this.store.set("encryptedPrivateJoinCodes", {
      ...this.store.get("encryptedPrivateJoinCodes"),
      [server.key]: this.encrypt(joinCode),
    });
    if (!this.store.get("favoriteServerKeys").includes(server.key))
      this.store.set("favoriteServerKeys", [
        ...this.store.get("favoriteServerKeys"),
        server.key,
      ]);
    if (open) this.selectServer(server.key);
  }
  selectServer(key: string) {
    if (!this.store.get("cachedServers").some((server) => server.key === key))
      throw new Error("Unknown server.");
    this.currentServerKey = key;
    if (this.store.get("favoriteServerKeys").includes(key))
      this.store.set("preferredServerKey", key);
  }
  showServerBrowser() {
    this.currentServerKey = "";
  }
  toggleFavorite(key: string) {
    const current = this.store.get("favoriteServerKeys");
    const favorites = current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key];
    this.store.set("favoriteServerKeys", favorites);
    if (favorites.includes(key) && this.currentServerKey === key)
      this.store.set("preferredServerKey", key);
    if (!favorites.includes(this.store.get("preferredServerKey")))
      this.store.set("preferredServerKey", "");
  }
  activeServer(): Server | null {
    const servers = this.store.get("cachedServers");
    return (
      servers.find((server) => server.key === this.currentServerKey) || null
    );
  }
  modpackPath(key = this.activeServer()?.key || ""): string {
    return this.store.get("modpackLocations")[key] || "";
  }
  setModpackPath(key: string, value: string) {
    this.store.set("modpackLocations", {
      ...this.store.get("modpackLocations"),
      [key]: value,
    });
  }
  publicSettings(): PublicSettings {
    return {
      skyrimPath: this.store.get("skyrimPath"),
      activeServerKey: this.activeServer()?.key || "",
      servers: this.store.get("cachedServers"),
      favoriteServerKeys: this.store.get("favoriteServerKeys"),
      directoryStatus: this.store.get("directoryStatus"),
      directoryError: this.store.get("directoryError"),
      discordUser: this.store.get("discordUser"),
      modpackPath: this.modpackPath(),
      locale: this.store.get("locale"),
      onboardingVersion: this.store.get("onboardingVersion"),
      launchAtLogin: this.store.get("launchAtLogin"),
      closeBehavior: this.store.get("closeBehavior"),
      afterLaunch: this.store.get("afterLaunch"),
      reduceMotion: this.store.get("reduceMotion"),
    };
  }
}
