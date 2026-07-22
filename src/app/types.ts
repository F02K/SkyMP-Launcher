export type Locale = "en" | "de";
export type CloseBehavior = "exit" | "tray";
export type AfterLaunch = "keep" | "minimize" | "close";

export interface Server {
  key: string;
  name: string;
  address: string;
  port: number;
}

export interface DiscordUser {
  username: string;
  tag?: string;
  avatar?: string | null;
}

export interface PublicSettings {
  skyrimPath: string;
  activeServerKey: string;
  servers: Server[];
  discordUser: DiscordUser | null;
  vortexPath: string;
  vortexEnabled: boolean;
  locale: Locale;
  onboardingVersion: number;
  launchAtLogin: boolean;
  closeBehavior: CloseBehavior;
  afterLaunch: AfterLaunch;
  reduceMotion: boolean;
}

export type InstallPhase =
  | "idle"
  | "preflight"
  | "awaiting-confirmation"
  | "downloading"
  | "verifying"
  | "staging"
  | "committing"
  | "rolling-back"
  | "complete"
  | "cancelled"
  | "error";

export interface InstallState {
  phase: InstallPhase;
  message: string;
  receivedBytes?: number;
  totalBytes?: number;
  percent?: number;
  canCancel?: boolean;
  canRetry?: boolean;
}

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ClientManifest {
  schemaVersion: 1;
  serverKey: string;
  version: string;
  archive: { size: number; sha256: string; etag?: string };
  files: ManifestFile[];
  signature: { algorithm: "ed25519"; value: string };
}

export interface PreflightCheck {
  id: string;
  status: "ok" | "warning" | "error" | "repairable";
  message: string;
}

export interface PreflightReport {
  ready: boolean;
  repairable: boolean;
  downloadBytes: number;
  offline: boolean;
  checks: PreflightCheck[];
}

export interface AppConfig {
  app: { productName: string; shortName: string; description: string };
  links: { website: string; discord: string; news: string };
  branding: { emblem: string; tagline: string; background: string };
  updates: { provider: string };
  behavior: { defaultLocale: Locale };
}

export interface ElectronApi {
  getAppConfig(): Promise<AppConfig>;
  loadSettings(): Promise<PublicSettings>;
  saveSettings(data: Partial<PublicSettings>): Promise<PublicSettings>;
  selectServer(key: string): Promise<PublicSettings>;
  openFolder(kind?: "skyrim" | "vortex"): Promise<string | null>;
  detectSkyrim(): Promise<{ found: boolean; path: string }>;
  vortexDetect(): Promise<{ found: boolean; path: string }>;
  vortexSync(): Promise<{ success: boolean; error?: string }>;
  fetchDashboard(): Promise<any>;
  discordLogin(): Promise<any>;
  discordLogout(): Promise<void>;
  preflight(): Promise<PreflightReport>;
  repair(): Promise<{ success: boolean; error?: string }>;
  cancelInstall(): Promise<boolean>;
  play(): Promise<{
    success: boolean;
    needsRepair?: boolean;
    preflight?: PreflightReport;
    error?: string;
  }>;
  exportDiagnostics(): Promise<{ success: boolean; path?: string }>;
  openExternal(url: string): Promise<boolean>;
  minimize(): void;
  maximize(): void;
  close(): void;
  getUpdateState(): Promise<any>;
  checkForUpdates(): Promise<any>;
  installUpdate(): Promise<boolean>;
  onInstallState(callback: (state: InstallState) => void): () => void;
  onUpdateState(callback: (state: any) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}
