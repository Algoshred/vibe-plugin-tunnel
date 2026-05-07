/**
 * Locally-redeclared types so the plugin has no hard dependency on
 * @vibecontrols/agent. Keeps plugin bundles self-contained.
 */

export type TunnelStatus =
  | "starting"
  | "active"
  | "stopping"
  | "stopped"
  | "error";

export type TunnelProtocol = "http" | "https" | "tcp" | "udp";

export interface TunnelProviderCapabilities {
  provider: string;
  supportsHttp: boolean;
  supportsHttps: boolean;
  supportsTcp: boolean;
  supportsUdp: boolean;
  supportsCustomDomains: boolean;
  supportsManagedSubdomains: boolean;
  supportsSessionTokens: boolean;
  supportsLiveLogs: boolean;
  supportsUsageMetrics: boolean;
  supportsRotateCredentials: boolean;
  platforms: string[];
}

export interface IssueSessionRequest {
  protocol: TunnelProtocol;
  localPort: number;
  localHost?: string;
  subdomain?: string;
  customDomain?: string;
  ttlSeconds?: number;
  metadata?: Record<string, unknown>;
  controlPlanePayload?: Record<string, unknown>;
}

export interface TunnelSessionInfo {
  sessionId: string;
  tunnelId: string;
  provider: string;
  managedHostname?: string;
  customDomains?: string[];
  expiresAt?: string;
  credentials: Record<string, unknown>;
}

export interface TunnelMetrics {
  bytesIn: number;
  bytesOut: number;
  connections: number;
  lastActivityAt?: string;
}

export interface TunnelInfo {
  id: string;
  providerName: string;
  status: TunnelStatus;
  protocol: TunnelProtocol;
  localPort: number;
  localHost: string;
  url: string;
  managedHostname?: string;
  customDomains?: string[];
  sessionId?: string;
  shardId?: string;
  pid?: number;
  createdAt: string;
  updatedAt?: string;
  metrics?: TunnelMetrics;
  metadata?: Record<string, unknown>;
}

export interface TunnelProvider {
  readonly name: string;
  getCapabilities(): TunnelProviderCapabilities;
  healthCheck(): Promise<{
    ok: boolean;
    message?: string;
    details?: Record<string, unknown>;
  }>;
  issueSession(req: IssueSessionRequest): Promise<TunnelSessionInfo>;
  start(tunnelId: string): Promise<TunnelInfo>;
  stop(tunnelId: string): Promise<void>;
  delete(tunnelId: string): Promise<void>;
  rotate(tunnelId: string): Promise<TunnelSessionInfo>;
  getStatus(tunnelId: string): Promise<TunnelInfo | null>;
  list(): Promise<TunnelInfo[]>;
  attachCustomDomain(tunnelId: string, domain: string): Promise<void>;
  detachCustomDomain(tunnelId: string, domain: string): Promise<void>;
  listSessions(tunnelId: string): Promise<TunnelSessionInfo[]>;
  getMetrics?(tunnelId: string): Promise<TunnelMetrics | null>;
  streamLogs?(tunnelId: string): AsyncIterable<string>;
  getActiveTunnelUrl?(): Promise<string | null>;
}

export interface ServiceRegistryLike {
  registerService?(
    pluginName: string,
    serviceName: string,
    service: unknown,
  ): void;
  getProviderByName<T>(type: string, name: string): T | undefined;
  listProvidersForType(
    type: string,
  ): Array<{ pluginName: string; isDefault: boolean }>;
  setProviderDefault?(type: string, name: string): void;
}

export interface HostLogger {
  info(source: string, msg: string, meta?: Record<string, unknown>): void;
  warn(source: string, msg: string, meta?: Record<string, unknown>): void;
  error(source: string, msg: string, meta?: Record<string, unknown>): void;
  debug(source: string, msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Minimal contributor surface — duck-typed against
 * `vibecontrols-agent`'s `CliContributorRegistry`. Plugin uses these to
 * inject status/doctor sections without depending on agent types.
 */
export interface CliContributorRegistryLike {
  addStatusSection(section: {
    source: string;
    title: string;
    render: (ctx: { agentUrl: string }) => Promise<string | null>;
    json?: (ctx: { agentUrl: string }) => Promise<unknown>;
    jsonKey?: string;
  }): void;
  addDoctorCheck(check: {
    source: string;
    run: () => Promise<
      Array<{
        name: string;
        ok: boolean;
        grade?: "warn";
        message: string;
        hint?: string;
      }>
    >;
  }): void;
}

export interface HostServices {
  telemetry?: {
    emit: (name: string, payload?: Record<string, unknown>) => void;
  };
  logger?: HostLogger;
  serviceRegistry?: ServiceRegistryLike;
  getConfig?(key: string): Promise<string | undefined>;
  setConfig?(key: string, value: string): Promise<void>;
  cliContributors?: CliContributorRegistryLike;
}

export type PluginTag =
  | "backend"
  | "frontend"
  | "cli"
  | "provider"
  | "adapter"
  | "integration";

export interface PluginCapabilities {
  storage?: "none" | "read" | "rw";
  secrets?: "none" | "read" | "rw";
  gateway?: boolean;
  broadcast?: boolean;
  subprocess?: boolean;
  audit?: boolean;
  telemetry?: boolean;
}

export interface VibePlugin {
  capabilities?: PluginCapabilities;
  name: string;
  version: string;
  description?: string;
  tags?: PluginTag[];
  cliCommand?: string;
  apiPrefix?: string;
  dependencies?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRoutes?: (deps: { serviceRegistry: ServiceRegistryLike }) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onCliSetup?: (
    program: any,
    hostServices: HostServices,
  ) => void | Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onServerStart?: (
    app: any,
    hostServices: HostServices,
  ) => void | Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onServerStop?: (ctx?: {
    reason: "reload" | "shutdown";
  }) => void | Promise<void>;
}

export const DEFAULT_PROVIDER_CONFIG_KEY = "provider:default:tunnel";
