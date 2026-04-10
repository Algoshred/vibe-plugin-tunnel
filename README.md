# @vibecontrols/vibe-plugin-tunnel

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
