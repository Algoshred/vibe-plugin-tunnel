/**
 * @vibecontrols/vibe-plugin-tunnel
 *
 * Tunnel manager / facade plugin. Owns /api/tunnels/* on the agent and
 * dispatches to concrete providers registered in the service registry
 * under type "tunnel" (e.g. tunnel-vibetunnels, tunnel-cloudflare).
 *
 * This plugin does NOT export providers.tunnel — it is not itself a
 * provider. It delegates to whichever provider the caller chooses, or
 * to the default configured via `vibe tunnel providers set-default`.
 */
import {
  createLifecycleHooks,
  ProviderRegistry,
  TelemetryEmitter,
} from "@vibecontrols/plugin-sdk";
import type {
  HostServices,
  ProfileContext,
  VibePlugin,
  VibePluginFactory,
} from "@vibecontrols/plugin-sdk/contract";

import { registerTunnelCommands } from "./commands.js";
import { TunnelManager } from "./manager.js";
import { createTunnelManagerRoutes } from "./routes.js";
import type { TunnelDoctorCheck, TunnelStatusSection } from "./types.js";

const PLUGIN_NAME = "tunnel";
const PLUGIN_VERSION = "0.1.0";

/**
 * Plugin Contract v2 factory. Per-profile state (the TunnelManager
 * instance) lives in this closure so concurrent profiles cannot share
 * a manager across ProfileContexts.
 */
export const createPlugin: VibePluginFactory = (
  _ctx: ProfileContext,
): VibePlugin => {
  const manager = new TunnelManager();
  const telemetry = new TelemetryEmitter(PLUGIN_NAME, PLUGIN_VERSION);

  const lifecycle = createLifecycleHooks({
    name: PLUGIN_NAME,
    telemetryEventName: "tunnel.meta.ready",
    onInit: (hostServices: HostServices) => {
      manager.init(hostServices);
      telemetry.emit("tunnel.manager.ready");
    },
  });

  return {
    capabilities: {
      storage: "rw",
      subprocess: true,
      broadcast: true,
      audit: true,
      telemetry: true,
    },
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    description:
      "VibeTunnels manager — dispatches to registered tunnel providers",
    tags: ["backend", "cli", "integration"],
    cliCommand: "tunnel",
    apiPrefix: "/api/tunnels",

    createRoutes: () => createTunnelManagerRoutes(manager),

    onServerStart: lifecycle.onServerStart,
    onServerStop: lifecycle.onServerStop,

    onCliSetup: (program: unknown, hostServices: HostServices) => {
      // Commander-shaped surface — typed locally in commands.ts.
      registerTunnelCommands(
        program as Parameters<typeof registerTunnelCommands>[0],
        hostServices,
      );
      registerCliContributors(hostServices);
    },
  };
};

function registerCliContributors(hostServices: HostServices): void {
  const providers = new ProviderRegistry(hostServices);

  // The agent's bare `/api/*` surface was retired; every data-plane
  // endpoint is profile-scoped. Resolve the running profile the same way
  // path-utils.ts does so this contributor addresses the canonical URL
  // (the bare path returns HTTP 410).
  const tunnelPath = (): string => {
    const profile = process.env.VIBECONTROLS_PROFILE || "default";
    return `/api/profiles/${encodeURIComponent(profile)}/agent/tunnel`;
  };

  const statusSection: TunnelStatusSection = {
    source: "tunnel",
    title: "Tunnel",
    render: async ({ agentUrl }) => {
      try {
        const res = await fetch(`${agentUrl}${tunnelPath()}`);
        if (!res.ok) return null;
        const t = (await res.json()) as {
          tunnelUrl?: string;
          publicUrl?: string;
          url?: string;
          status?: string;
        };
        const url = t.tunnelUrl ?? t.publicUrl ?? t.url;
        if (url) return `\x1b[32m${url}\x1b[39m`;
        const status = t.status ?? "unknown";
        if (status === "active" || status === "running")
          return "\x1b[33mstarting...\x1b[39m";
        return "\x1b[2m(not running)\x1b[22m";
      } catch {
        return null;
      }
    },
    json: async ({ agentUrl }) => {
      try {
        const res = await fetch(`${agentUrl}${tunnelPath()}`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    jsonKey: "tunnel",
  };

  const doctorCheck: TunnelDoctorCheck = {
    source: "tunnel",
    run: async () => {
      // The plugin reads its own state via the agent API rather than
      // touching the agent's filesystem directly. Falls through silently
      // when the route isn't reachable yet.
      try {
        const port = (process.env.AGENT_URL ?? "http://localhost:3005").replace(
          /\/+$/,
          "",
        );
        const res = await fetch(`${port}${tunnelPath()}`);
        if (!res.ok) return [];
        const t = (await res.json()) as {
          status?: string;
          provider?: string;
          tunnelUrl?: string;
          pid?: number;
        };
        if (!t.status || t.status === "stopped") {
          return [
            {
              name: "Tunnel state",
              ok: true,
              message: "no tunnel currently running",
            },
          ];
        }
        if (t.status === "active" || t.status === "running") {
          return [
            {
              name: "Tunnel state",
              ok: true,
              message: `${t.provider ?? "tunnel"} alive → ${t.tunnelUrl ?? "(no url)"}`,
            },
          ];
        }
        return [
          {
            name: "Tunnel state",
            ok: false,
            grade: "warn" as const,
            message: `tunnel reports status=${t.status}`,
            hint: "Run `vibe tunnel kill --orphans` to clean up.",
          },
        ];
      } catch {
        return [];
      }
    },
  };

  providers.withCliContribution({
    statusSections: [statusSection],
    doctorChecks: [doctorCheck],
  });
}

export default createPlugin;
export { TunnelManager } from "./manager.js";
export type * from "./types.js";
