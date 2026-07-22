import { app, safeStorage } from "electron";
import Store from "electron-store";
import type { DiscordUser, PublicSettings, Server } from "./types.js";

type StoreShape = {
  skyrimPath: string;
  activeServerKey: string;
  activeServerIndex?: number;
  cachedServers: Server[];
  filesVersion?: string;
  installedManifests: Record<string, unknown>;
  discordUser: DiscordUser | null;
  gameProfileId: number | null;
  gameSession?: string;
  encryptedGameSession: string;
  nexusApiKey?: string;
  encryptedNexusApiKey: string;
  vortexPath: string;
  vortexEnabled: boolean;
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
  constructor() {
    const detectedLocale = app.getLocale().toLowerCase().startsWith("de")
      ? "de"
      : "en";
    this.store = new Store<StoreShape>({
      defaults: {
        skyrimPath: "",
        activeServerKey: "",
        cachedServers: [],
        installedManifests: {},
        discordUser: null,
        gameProfileId: null,
        encryptedGameSession: "",
        encryptedNexusApiKey: "",
        vortexPath: "",
        vortexEnabled: false,
        locale: detectedLocale,
        onboardingVersion: 0,
        launchAtLogin: false,
        closeBehavior: "exit",
        afterLaunch: "minimize",
        reduceMotion: false,
        lastCrash: "",
      },
    });
    this.migrateSecrets();
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
  private migrateSecrets() {
    const plainSession = this.store.get("gameSession") || "";
    if (plainSession && !this.store.get("encryptedGameSession"))
      this.store.set("encryptedGameSession", this.encrypt(plainSession));
    const plainKey = this.store.get("nexusApiKey") || "";
    if (plainKey && !this.store.get("encryptedNexusApiKey"))
      this.store.set("encryptedNexusApiKey", this.encrypt(plainKey));
    this.store.delete("gameSession");
    this.store.delete("nexusApiKey");
  }
  getSession() {
    return this.decrypt(this.store.get("encryptedGameSession"));
  }
  setSession(value: string) {
    this.store.set("encryptedGameSession", this.encrypt(value));
  }
  clearSession() {
    this.store.set("encryptedGameSession", "");
  }
  getNexusApiKey() {
    return this.decrypt(this.store.get("encryptedNexusApiKey"));
  }
  setServers(servers: Server[]) {
    this.store.set("cachedServers", servers);
    if (!this.store.get("activeServerKey")) {
      const legacy = this.store.get("activeServerIndex") || 0;
      this.store.set(
        "activeServerKey",
        servers[legacy]?.key || servers[0]?.key || "",
      );
    }
    this.store.delete("activeServerIndex");
  }
  activeServer(): Server | null {
    const servers = this.store.get("cachedServers");
    const key = this.store.get("activeServerKey");
    return servers.find((server) => server.key === key) || servers[0] || null;
  }
  publicSettings(): PublicSettings {
    return {
      skyrimPath: this.store.get("skyrimPath"),
      activeServerKey: this.activeServer()?.key || "",
      servers: this.store.get("cachedServers"),
      discordUser: this.store.get("discordUser"),
      vortexPath: this.store.get("vortexPath"),
      vortexEnabled: this.store.get("vortexEnabled"),
      locale: this.store.get("locale"),
      onboardingVersion: this.store.get("onboardingVersion"),
      launchAtLogin: this.store.get("launchAtLogin"),
      closeBehavior: this.store.get("closeBehavior"),
      afterLaunch: this.store.get("afterLaunch"),
      reduceMotion: this.store.get("reduceMotion"),
    };
  }
}
