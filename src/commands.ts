/**
 * CLI commands for the tunnel manager. Registered via onCliSetup. Calls
 * the local agent REST API rather than touching providers directly so the
 * same flow works whether the agent is in-process or on localhost.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HostServices } from "./types.js";

const DEFAULT_AGENT_URL = "http://localhost:3005";

function agentBaseUrl(): string {
  return process.env.AGENT_BASE_URL ?? DEFAULT_AGENT_URL;
}

/**
 * Resolve the agent's API key for outbound CLI calls. The auth plugin
 * requires it on every `/api/*` route. Resolution mirrors the agent's own
 * `getAgentApiKey()` so the CLI works whether the operator passed
 * AGENT_API_KEY/x-agent-api-key explicitly or relies on the persisted
 * key in `<agent-dir>/config.json` (set on first boot).
 */
function authHeaders(): Record<string, string> {
  const fromEnv = process.env.AGENT_API_KEY ?? process.env.X_AGENT_API_KEY;
  if (fromEnv) return { "x-agent-api-key": fromEnv };
  try {
    // Best-effort: the agent persists `static-api-key` to its config.json.
    // We read it lazily so the CLI doesn't pull in heavy deps just for auth.
    const { readFileSync, existsSync } = require("node:fs") as typeof import("node:fs");
    const { join, resolve } = require("node:path") as typeof import("node:path");
    const dir = process.env.VIBECONTROLS_HOME
      ?? join(process.cwd(), ".boff", "vibecontrols");
    const configPath = join(
      resolve(dir),
      "agents",
      process.env.VIBECONTROLS_AGENT_ID ?? "default",
      "config.json",
    );
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as { "static-api-key"?: string };
      if (cfg["static-api-key"]) return { "x-agent-api-key": cfg["static-api-key"] };
    }
  } catch {
    // Fall through — caller will surface the 401 as a clear error.
  }
  return {};
}

async function apiGet<T = any>(path: string): Promise<T> {
  const res = await fetch(`${agentBaseUrl()}/api/tunnels${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${agentBaseUrl()}/api/tunnels${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

async function apiDelete<T = any>(path: string): Promise<T> {
  const res = await fetch(`${agentBaseUrl()}/api/tunnels${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DELETE ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

export function registerTunnelCommands(
  program: any,
  _hostServices: HostServices,
): void {
  const cmd = program
    .command("tunnel")
    .description("Manage tunnels across providers");

  cmd
    .command("list")
    .description("List tunnels (optionally filtered by provider)")
    .option("--provider <name>", "Limit to a specific provider")
    .action(async (opts: { provider?: string }) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      const result = await apiGet<{ tunnels: any[] }>(`/${qs}`);
      if (result.tunnels.length === 0) {
        console.log("No tunnels.");
        return;
      }
      for (const t of result.tunnels) {
        console.log(
          `${t.id}\t${t.providerName}\t${t.status}\t${t.url}\t${t.protocol}:${t.localPort}`,
        );
      }
    });

  cmd
    .command("get <tunnelId>")
    .description("Get tunnel status")
    .option("--provider <name>")
    .action(async (tunnelId: string, opts: { provider?: string }) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      const result = await apiGet(`/${tunnelId}${qs}`);
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("start <tunnelId>")
    .description("Start a prepared tunnel session")
    .option("--provider <name>")
    .action(async (tunnelId: string, opts: { provider?: string }) => {
      const result = await apiPost(`/${tunnelId}/start`, {
        provider: opts.provider,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("stop <tunnelId>")
    .description("Stop an active tunnel")
    .option("--provider <name>")
    .action(async (tunnelId: string, opts: { provider?: string }) => {
      const result = await apiPost(`/${tunnelId}/stop`, {
        provider: opts.provider,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("delete <tunnelId>")
    .description("Delete a tunnel")
    .option("--provider <name>")
    .action(async (tunnelId: string, opts: { provider?: string }) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      const result = await apiDelete(`/${tunnelId}${qs}`);
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("sessions <tunnelId>")
    .description("List sessions for a tunnel")
    .option("--provider <name>")
    .action(async (tunnelId: string, opts: { provider?: string }) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      const result = await apiGet(`/${tunnelId}/sessions${qs}`);
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("status")
    .description("Manager + per-provider health summary")
    .action(async () => {
      const result = await apiGet(`/health`);
      console.log(JSON.stringify(result, null, 2));
    });

  const providersCmd = cmd
    .command("providers")
    .description("Manage tunnel providers");

  providersCmd
    .command("list")
    .description("List registered tunnel providers and capabilities")
    .action(async () => {
      const result = await apiGet<{ providers: any[] }>(`/providers`);
      for (const p of result.providers) {
        const star = p.isDefault ? "* " : "  ";
        const ok = p.health.ok ? "ok" : `error (${p.health.message ?? ""})`;
        console.log(`${star}${p.name}\t[${ok}]`);
      }
    });

  providersCmd
    .command("set-default <name>")
    .description("Set the default tunnel provider")
    .action(async (name: string) => {
      const result = await apiPost(`/default`, { provider: name });
      console.log(JSON.stringify(result, null, 2));
    });

  const domainsCmd = cmd
    .command("domains")
    .description("Manage custom domains on a tunnel");

  domainsCmd
    .command("add <tunnelId> <domain>")
    .option("--provider <name>")
    .action(
      async (tunnelId: string, domain: string, opts: { provider?: string }) => {
        const result = await apiPost(`/${tunnelId}/domains`, {
          domain,
          provider: opts.provider,
        });
        console.log(JSON.stringify(result, null, 2));
      },
    );

  domainsCmd
    .command("rm <tunnelId> <domain>")
    .option("--provider <name>")
    .action(
      async (tunnelId: string, domain: string, opts: { provider?: string }) => {
        const qs = opts.provider
          ? `?provider=${encodeURIComponent(opts.provider)}`
          : "";
        const result = await apiDelete(
          `/${tunnelId}/domains/${encodeURIComponent(domain)}${qs}`,
        );
        console.log(JSON.stringify(result, null, 2));
      },
    );

  cmd
    .command("doctor")
    .description("Diagnose tunnel providers")
    .action(async () => {
      try {
        const health = await apiGet<any>(`/health`);
        console.log(`manager: ${health.manager}`);
        for (const p of health.providers) {
          console.log(`  ${p.name}: ${p.ok ? "ok" : `fail - ${p.message}`}`);
        }
      } catch (err) {
        console.error(`Failed to reach agent: ${err}`);
        process.exitCode = 1;
      }
    });
}
