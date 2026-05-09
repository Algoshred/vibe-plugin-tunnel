/**
 * Tunnel-domain types (provider contract, session/info shapes). Plugin
 * lifecycle / host / profile / capability types now come from
 * `@vibecontrols/plugin-sdk` and `@vibecontrols/plugin-sdk/contract`.
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

/**
 * The tunnel manager dispatches via the agent's runtime registry which
 * exposes a richer surface than the SDK's neutral `ServiceRegistry`
 * (provider defaults, listing as `{pluginName, isDefault}` entries).
 * We declare a structural extension so the manager can talk to it
 * without depending on the agent package directly.
 */
export interface TunnelServiceRegistry {
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

/**
 * Status / doctor contributor entry shapes — duck-typed against the
 * agent's `CliContributorRegistry`. Used as the strongly-typed inputs to
 * `ProviderRegistry.withCliContribution`.
 */
export interface TunnelStatusSection {
  source: string;
  title: string;
  render: (ctx: { agentUrl: string }) => Promise<string | null>;
  json?: (ctx: { agentUrl: string }) => Promise<unknown>;
  jsonKey?: string;
}

export interface TunnelDoctorCheck {
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
}

export const DEFAULT_PROVIDER_CONFIG_KEY = "provider:default:tunnel";
