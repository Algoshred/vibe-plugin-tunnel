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
import { registerTunnelCommands } from "./commands.js";
import { TunnelManager } from "./manager.js";
import { createTunnelManagerRoutes } from "./routes.js";
import type { HostServices, VibePlugin } from "./types.js";

const manager = new TunnelManager();

export const vibePlugin: VibePlugin = {
  name: "tunnel",
  version: "0.1.0",
  description:
    "VibeTunnels manager — dispatches to registered tunnel providers",
  tags: ["backend", "cli", "integration"],
  cliCommand: "tunnel",
  apiPrefix: "/api/tunnels",

  createRoutes: () => createTunnelManagerRoutes(manager),

  onServerStart: (_app: unknown, hostServices: HostServices) => {
    manager.init(hostServices);
  },

  onCliSetup: (program: unknown, hostServices: HostServices) => {
    registerTunnelCommands(program, hostServices);
    registerStatusContributors(hostServices);
  },
};

function registerStatusContributors(hostServices: HostServices): void {
  const reg = hostServices.cliContributors;
  if (!reg) return; // older agent without contributor registry — graceful no-op

  reg.addStatusSection({
    source: "tunnel",
    title: "Tunnel",
    render: async ({ agentUrl }) => {
      try {
        const res = await fetch(`${agentUrl}/api/agent/tunnel`);
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
        const res = await fetch(`${agentUrl}/api/agent/tunnel`);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    jsonKey: "tunnel",
  });

  reg.addDoctorCheck({
    source: "tunnel",
    run: async () => {
      // The plugin reads its own state via the agent API rather than
      // touching the agent's filesystem directly. Falls through silently
      // when the route isn't reachable yet.
      try {
        const port = (process.env.AGENT_URL ?? "http://localhost:3005")
          .replace(/\/+$/, "");
        const res = await fetch(`${port}/api/agent/tunnel`);
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
  });
}

export default vibePlugin;
export { TunnelManager } from "./manager.js";
export type * from "./types.js";
