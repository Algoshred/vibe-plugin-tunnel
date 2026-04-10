/**
 * HTTP routes (Elysia) for the tunnel manager. Mounted under /api/tunnels.
 */
import { Elysia, t } from "elysia";

import type { TunnelManager } from "./manager.js";

function readProvider(
  query: Record<string, string | undefined> | undefined,
): string | undefined {
  return query?.["provider"] ?? undefined;
}

export function createTunnelManagerRoutes(manager: TunnelManager) {
  return (
    new Elysia()
      // List providers + capabilities + health
      .get("/providers", async ({ set }) => {
        try {
          const providers = await manager.listProviders();
          return { providers };
        } catch (err) {
          set.status = 500;
          return { error: "Failed to list providers", details: String(err) };
        }
      })

      // Set default provider
      .post(
        "/default",
        async ({ body, set }) => {
          try {
            await manager.setDefault(body.provider);
            return { success: true, provider: body.provider };
          } catch (err) {
            set.status = 400;
            return { error: String(err) };
          }
        },
        { body: t.Object({ provider: t.String() }) },
      )

      // Manager + per-provider health
      .get("/health", async ({ set }) => {
        try {
          return await manager.getHealth();
        } catch (err) {
          set.status = 500;
          return { error: "Failed to get health", details: String(err) };
        }
      })

      // List tunnels across every provider (or one via ?provider=...)
      .get("/", async ({ query, set }) => {
        try {
          const providerName = readProvider(query);
          const results = await manager.listAllTunnels(providerName);
          // Flatten for backward compatibility with the old core plugin
          // which returned a single `tunnels` array.
          const flat = results.flatMap((r) =>
            r.tunnels.map((t) => ({ ...t, providerName: r.provider })),
          );
          return { tunnels: flat, byProvider: results };
        } catch (err) {
          set.status = 500;
          return { error: "Failed to list tunnels", details: String(err) };
        }
      })

      // Issue a new session
      .post(
        "/issue-session",
        async ({ body, set }) => {
          try {
            const session = await manager.issueSession({
              provider: body.provider,
              protocol: body.protocol,
              localPort: body.localPort,
              localHost: body.localHost,
              subdomain: body.subdomain,
              customDomain: body.customDomain,
              ttlSeconds: body.ttlSeconds,
              metadata: body.metadata,
              controlPlanePayload: body.controlPlanePayload,
            });
            return session;
          } catch (err) {
            set.status = 500;
            return { error: "Failed to issue session", details: String(err) };
          }
        },
        {
          body: t.Object({
            provider: t.Optional(t.String()),
            protocol: t.Union([
              t.Literal("http"),
              t.Literal("https"),
              t.Literal("tcp"),
              t.Literal("udp"),
            ]),
            localPort: t.Number(),
            localHost: t.Optional(t.String()),
            subdomain: t.Optional(t.String()),
            customDomain: t.Optional(t.String()),
            ttlSeconds: t.Optional(t.Number()),
            metadata: t.Optional(t.Any()),
            controlPlanePayload: t.Optional(t.Any()),
          }),
        },
      )

      // Get a single tunnel (fans out if provider unspecified)
      .get("/:id", async ({ params, query, set }) => {
        try {
          const result = await manager.getTunnel(params.id, {
            provider: readProvider(query),
          });
          if (!result) {
            set.status = 404;
            return { error: "Tunnel not found" };
          }
          return result;
        } catch (err) {
          set.status = 500;
          return { error: "Failed to get tunnel", details: String(err) };
        }
      })

      // List sessions for a tunnel
      .get("/:id/sessions", async ({ params, query, set }) => {
        try {
          const sessions = await manager.listSessions(params.id, {
            provider: readProvider(query),
          });
          return { sessions };
        } catch (err) {
          set.status = 500;
          return { error: "Failed to list sessions", details: String(err) };
        }
      })

      // Start a prepared tunnel session
      .post(
        "/:id/start",
        async ({ params, body, set }) => {
          try {
            const tunnel = await manager.startTunnel(params.id, {
              provider: body?.provider,
            });
            return { success: true, tunnel };
          } catch (err) {
            set.status = 500;
            return { error: "Failed to start tunnel", details: String(err) };
          }
        },
        { body: t.Optional(t.Object({ provider: t.Optional(t.String()) })) },
      )

      // Stop an active tunnel
      .post(
        "/:id/stop",
        async ({ params, body, set }) => {
          try {
            await manager.stopTunnel(params.id, { provider: body?.provider });
            return { success: true };
          } catch (err) {
            set.status = 500;
            return { error: "Failed to stop tunnel", details: String(err) };
          }
        },
        { body: t.Optional(t.Object({ provider: t.Optional(t.String()) })) },
      )

      // Rotate tunnel credentials
      .post(
        "/:id/rotate",
        async ({ params, body, set }) => {
          try {
            const session = await manager.rotate(params.id, {
              provider: body?.provider,
            });
            return { success: true, session };
          } catch (err) {
            set.status = 500;
            return { error: "Failed to rotate tunnel", details: String(err) };
          }
        },
        { body: t.Optional(t.Object({ provider: t.Optional(t.String()) })) },
      )

      // Delete a tunnel
      .delete("/:id", async ({ params, query, set }) => {
        try {
          await manager.deleteTunnel(params.id, {
            provider: readProvider(query),
          });
          return { success: true };
        } catch (err) {
          set.status = 500;
          return { error: "Failed to delete tunnel", details: String(err) };
        }
      })

      // Attach a custom domain to a tunnel
      .post(
        "/:id/domains",
        async ({ params, body, set }) => {
          try {
            await manager.attachDomain(params.id, body.domain, {
              provider: body.provider,
            });
            return { success: true };
          } catch (err) {
            set.status = 500;
            return { error: "Failed to attach domain", details: String(err) };
          }
        },
        {
          body: t.Object({
            domain: t.String(),
            provider: t.Optional(t.String()),
          }),
        },
      )

      // Detach a custom domain from a tunnel
      .delete("/:id/domains/:domain", async ({ params, query, set }) => {
        try {
          await manager.detachDomain(params.id, params.domain, {
            provider: readProvider(query),
          });
          return { success: true };
        } catch (err) {
          set.status = 500;
          return { error: "Failed to detach domain", details: String(err) };
        }
      })
  );
}
