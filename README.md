# @vibecontrols/vibe-plugin-tunnel

<!-- VIBECONTROLS_OSS_HEADER_START -->

> **License**: MIT — see [LICENSE](./LICENSE).
> **Note**: This plugin is open source. The `@vibecontrols/agent` runtime that loads it is **not** open source — it is a proprietary product of Burdenoff Consultancy Services Pvt. Ltd. See [vibecontrols.com](https://vibecontrols.com) for the agent.

<!-- VIBECONTROLS_OSS_HEADER_END -->

Unified tunnel manager plugin for VibeControls Agent. Facade over registered
concrete tunnel providers such as `@vibecontrols/vibe-plugin-tunnel-vibetunnels`
(frp) and `@vibecontrols/vibe-plugin-tunnel-cloudflare` (cloudflared).

This plugin owns the `/api/tunnels/*` REST surface on the agent and dispatches
each request to the correct provider based on an explicit `provider` field
or the configured default.

## Install

```
bun install -g @vibecontrols/vibe-plugin-tunnel
```

Installed automatically by `vibe start` as part of the default tunnel
plugin set.

## Usage

```
# List all tunnels across every provider
vibe tunnel list

# List registered providers with capabilities
vibe tunnel providers

# Set the default provider
vibe tunnel providers set-default tunnel-vibetunnels
```

## Design

The manager does not implement the `TunnelProvider` interface itself. It
uses the agent's service registry to look up concrete providers by name:

```ts
const provider = serviceRegistry.getProviderByName<TunnelProvider>(
  "tunnel",
  "tunnel-vibetunnels",
);
```

Each operation accepts an optional `provider` argument. If omitted the
manager resolves the default from agent config
(`db:provider:default:tunnel`).

<!-- VIBECONTROLS_OSS_FOOTER_START -->

---

## License

Released under the [MIT License](./LICENSE).

Copyright (c) 2026 Burdenoff Consultancy Services Private Limited, Algoshred Technologies Private Limited, and all its sister companies.

Maintainer: **Vignesh T.V** — <https://github.com/tvvignesh>

## About VibeControls

**VibeControls** is the agentic engineering mission control for AI-native teams. Vibe-plugins extend the VibeControls agent with new providers, tools, sessions, tunnels, storage backends, and security stages.

- Website: <https://vibecontrols.com>
- Documentation: <https://docs.vibecontrols.com>
- Plugin SDK: <https://github.com/algoshred/vibecontrols-plugin-sdk>
- All plugins: <https://github.com/algoshred?q=vibe-plugin-&type=all>

## Important: agent is not open source

The `@vibecontrols/agent` runtime that loads and orchestrates these plugins is **closed source** and proprietary to Burdenoff Consultancy Services Pvt. Ltd. Only the plugin contract and the plugins themselves are released under MIT. If you want a fully self-hostable agent, please open an issue or contact the maintainer.

<!-- VIBECONTROLS_OSS_FOOTER_END -->
