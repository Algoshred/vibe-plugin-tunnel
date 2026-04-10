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
  },
};

export default vibePlugin;
export { TunnelManager } from "./manager.js";
export type * from "./types.js";
