/**
 * TunnelManager — facade over registered tunnel providers.
 *
 * Looks up concrete providers in the agent's service registry by name and
 * dispatches each operation to the selected provider. Falls back to the
 * configured default provider when no explicit name is given.
 */
import { BoundLogger } from "@vibecontrols/plugin-sdk";
import type { HostServices } from "@vibecontrols/plugin-sdk/contract";

import {
  DEFAULT_PROVIDER_CONFIG_KEY,
  type IssueSessionRequest,
  type TunnelInfo,
  type TunnelProvider,
  type TunnelProviderCapabilities,
  type TunnelServiceRegistry,
  type TunnelSessionInfo,
} from "./types.js";

const LOG_SOURCE = "tunnel-manager";

export interface ProviderSnapshot {
  name: string;
  isDefault: boolean;
  capabilities: TunnelProviderCapabilities;
  health: { ok: boolean; message?: string };
}

export interface TunnelDispatchOptions {
  provider?: string;
}

export class TunnelManager {
  private registry?: TunnelServiceRegistry;
  private host?: HostServices;
  private log: BoundLogger = new BoundLogger(undefined, LOG_SOURCE);

  init(host: HostServices): void {
    this.host = host;
    // The agent's runtime registry exposes a richer surface than the SDK's
    // neutral `ServiceRegistry` (provider defaults + listing entries). It's
    // structurally compatible — narrow via a single cast at the boundary.
    this.registry = host.serviceRegistry as unknown as
      | TunnelServiceRegistry
      | undefined;
    this.log = new BoundLogger(host.logger, LOG_SOURCE);
    this.log.info("Tunnel manager initialized");
  }

  // ── Provider resolution ──────────────────────────────────────────────

  private async resolveProvider(name?: string): Promise<TunnelProvider> {
    if (!this.registry) {
      throw new Error("Service registry not available");
    }

    const explicit = name?.trim();
    if (explicit) {
      const provider = this.registry.getProviderByName<TunnelProvider>(
        "tunnel",
        explicit,
      );
      if (!provider) {
        throw new Error(`Tunnel provider '${explicit}' is not registered`);
      }
      return provider;
    }

    const fallback = await this.defaultProviderName();
    if (!fallback) {
      throw new Error(
        "No default tunnel provider configured and none specified",
      );
    }
    const provider = this.registry.getProviderByName<TunnelProvider>(
      "tunnel",
      fallback,
    );
    if (!provider) {
      throw new Error(
        `Default tunnel provider '${fallback}' is not registered`,
      );
    }
    return provider;
  }

  private async defaultProviderName(): Promise<string | undefined> {
    const fromConfig = await this.host?.getConfig?.(
      DEFAULT_PROVIDER_CONFIG_KEY,
    );
    if (fromConfig) return fromConfig;

    // Fall back to whichever provider is marked default in the registry
    // (the agent runtime may set this automatically from DB).
    const entries = this.registry?.listProvidersForType("tunnel") ?? [];
    const flagged = entries.find((e) => e.isDefault);
    if (flagged) return flagged.pluginName;

    // Finally, first provider in the list if there's only one.
    if (entries.length === 1) return entries[0]!.pluginName;
    return undefined;
  }

  private listProviderEntries(): Array<{
    pluginName: string;
    isDefault: boolean;
  }> {
    return this.registry?.listProvidersForType("tunnel") ?? [];
  }

  // ── High-level operations ────────────────────────────────────────────

  async listAllTunnels(
    filterProvider?: string,
  ): Promise<Array<{ provider: string; tunnels: TunnelInfo[] }>> {
    const entries = this.listProviderEntries();
    const targeted = filterProvider
      ? entries.filter((e) => e.pluginName === filterProvider)
      : entries;

    const results: Array<{ provider: string; tunnels: TunnelInfo[] }> = [];
    for (const entry of targeted) {
      const provider = this.registry?.getProviderByName<TunnelProvider>(
        "tunnel",
        entry.pluginName,
      );
      if (!provider) continue;
      try {
        const tunnels = await provider.list();
        results.push({ provider: entry.pluginName, tunnels });
      } catch (err) {
        this.log.warn(`listAllTunnels: ${entry.pluginName} failed`, {
          error: String(err),
        });
      }
    }
    return results;
  }

  async listProviders(): Promise<ProviderSnapshot[]> {
    const entries = this.listProviderEntries();
    const snapshots: ProviderSnapshot[] = [];
    for (const entry of entries) {
      const provider = this.registry?.getProviderByName<TunnelProvider>(
        "tunnel",
        entry.pluginName,
      );
      if (!provider) continue;
      let health: { ok: boolean; message?: string };
      try {
        health = await provider.healthCheck();
      } catch (err) {
        health = { ok: false, message: String(err) };
      }
      snapshots.push({
        name: entry.pluginName,
        isDefault: entry.isDefault,
        capabilities: provider.getCapabilities(),
        health,
      });
    }
    return snapshots;
  }

  async getTunnel(
    id: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<{ provider: string; tunnel: TunnelInfo } | null> {
    if (opts.provider) {
      const provider = await this.resolveProvider(opts.provider);
      const tunnel = await provider.getStatus(id);
      return tunnel ? { provider: provider.name, tunnel } : null;
    }

    // Fan out across providers.
    for (const entry of this.listProviderEntries()) {
      const provider = this.registry?.getProviderByName<TunnelProvider>(
        "tunnel",
        entry.pluginName,
      );
      if (!provider) continue;
      try {
        const tunnel = await provider.getStatus(id);
        if (tunnel) return { provider: entry.pluginName, tunnel };
      } catch {
        // Ignore per-provider errors during fan-out.
      }
    }
    return null;
  }

  async issueSession(
    req: IssueSessionRequest & TunnelDispatchOptions,
  ): Promise<TunnelSessionInfo & { provider: string }> {
    const { provider: providerName, ...rest } = req;
    const provider = await this.resolveProvider(providerName);
    const session = await provider.issueSession(rest);
    return { ...session, provider: provider.name };
  }

  async startTunnel(
    id: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<TunnelInfo> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.start(id);
  }

  async stopTunnel(
    id: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<void> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.stop(id);
  }

  async deleteTunnel(
    id: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<void> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.delete(id);
  }

  async rotate(
    id: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<TunnelSessionInfo> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.rotate(id);
  }

  async attachDomain(
    id: string,
    domain: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<void> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.attachCustomDomain(id, domain);
  }

  async detachDomain(
    id: string,
    domain: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<void> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.detachCustomDomain(id, domain);
  }

  async listSessions(
    id: string,
    opts: TunnelDispatchOptions = {},
  ): Promise<TunnelSessionInfo[]> {
    const provider = await this.resolveProvider(opts.provider);
    return provider.listSessions(id);
  }

  async getHealth(): Promise<{
    manager: "ok";
    providers: Array<{ name: string; ok: boolean; message?: string }>;
  }> {
    const entries = this.listProviderEntries();
    const providers: Array<{ name: string; ok: boolean; message?: string }> =
      [];
    for (const entry of entries) {
      const provider = this.registry?.getProviderByName<TunnelProvider>(
        "tunnel",
        entry.pluginName,
      );
      if (!provider) {
        providers.push({
          name: entry.pluginName,
          ok: false,
          message: "unavailable",
        });
        continue;
      }
      try {
        const result = await provider.healthCheck();
        providers.push({
          name: entry.pluginName,
          ok: result.ok,
          message: result.message,
        });
      } catch (err) {
        providers.push({
          name: entry.pluginName,
          ok: false,
          message: String(err),
        });
      }
    }
    return { manager: "ok", providers };
  }

  async setDefault(providerName: string): Promise<void> {
    // Validate the provider exists.
    await this.resolveProvider(providerName);

    if (this.registry?.setProviderDefault) {
      this.registry.setProviderDefault("tunnel", providerName);
    }
    // The agent's runtime host exposes `setConfig`, but the SDK contract
    // surface only declares `getConfig`. Optional-chain through a narrow
    // structural cast so we persist when the host supports it and no-op
    // otherwise.
    const hostWithSetConfig = this.host as
      | (HostServices & {
          setConfig?: (key: string, value: string) => Promise<void>;
        })
      | undefined;
    if (hostWithSetConfig?.setConfig) {
      await hostWithSetConfig.setConfig(
        DEFAULT_PROVIDER_CONFIG_KEY,
        providerName,
      );
    }
    this.log.info(`Default tunnel provider set to ${providerName}`);
  }
}
