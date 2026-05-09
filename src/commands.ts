/**
 * CLI commands for the tunnel manager. Registered via onCliSetup. Calls
 * the local agent REST API rather than touching providers directly so the
 * same flow works whether the agent is in-process or on localhost.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { HostServices } from "@vibecontrols/plugin-sdk/contract";

import {
  runMultimode,
  pickOutputMode,
  maybePrintJson,
  type OutputFlags,
} from "./utils/multimode.js";
import {
  interactiveTable,
  interactiveDetail,
  type TableRow,
} from "./utils/interactive.js";

const DEFAULT_AGENT_URL = "http://localhost:3005";

function agentBaseUrl(): string {
  return process.env.AGENT_BASE_URL ?? DEFAULT_AGENT_URL;
}

/** Redact obvious secret-shaped fields recursively for JSON output. */
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(token|secret|password|apikey|api_key)/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out;
  }
  return value;
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
    const dir =
      process.env.VIBECONTROLS_HOME ??
      join(process.cwd(), ".boff", "vibecontrols");
    const configPath = join(
      resolve(dir),
      "agents",
      process.env.VIBECONTROLS_PROFILE ?? "default",
      "config.json",
    );
    if (existsSync(configPath)) {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8")) as {
        "static-api-key"?: string;
      };
      if (cfg["static-api-key"])
        return { "x-agent-api-key": cfg["static-api-key"] };
    }
  } catch {
    // Fall through — caller will surface the 401 as a clear error.
  }
  return {};
}

async function apiGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${agentBaseUrl()}/api/tunnels${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
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

async function apiDelete<T = unknown>(path: string): Promise<T> {
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

interface CommonFlags extends OutputFlags {
  provider?: string;
}

interface TunnelRow {
  id?: string | number;
  providerName?: string;
  status?: string;
  url?: string;
  protocol?: string;
  localPort?: number;
  domains?: string[];
}

interface ProviderRow {
  name: string;
  isDefault?: boolean;
  health: { ok: boolean; message?: string };
}

interface SessionRow {
  id?: string | number;
  status?: string;
}

interface HealthShape {
  manager: string;
  providers: Array<{ name: string; ok: boolean; message?: string }>;
}

/**
 * Minimal commander-shaped surface — keeps the plugin free of a hard
 * dependency on the `commander` package while still type-checking the
 * builder chain.
 */
/**
 * Minimal commander-shaped surface. We type `.action` as a generic so the
 * concrete handler signature for each subcommand is preserved without
 * needing `any` or eslint-disable comments. Mirrors commander.js's runtime
 * contract where each positional `<arg>` becomes a leading parameter and
 * trailing parameters carry the parsed flags.
 */
interface CommanderLike {
  command(name: string): CommanderLike;
  description(text: string): CommanderLike;
  option(flag: string, description?: string): CommanderLike;
  action<H extends (...args: never[]) => unknown>(handler: H): CommanderLike;
}

function tunnelDetail(t: TunnelRow): string {
  const lines = [
    `id:        ${t.id ?? "-"}`,
    `provider:  ${t.providerName ?? "-"}`,
    `status:    ${t.status ?? "-"}`,
    `url:       ${t.url ?? "-"}`,
    `protocol:  ${t.protocol ?? "-"}`,
    `localPort: ${t.localPort ?? "-"}`,
  ];
  if (t.domains && Array.isArray(t.domains) && t.domains.length > 0) {
    lines.push(`domains:   ${t.domains.join(", ")}`);
  }
  return lines.join("\n");
}

export function registerTunnelCommands(
  program: CommanderLike,
  _hostServices: HostServices,
): void {
  const cmd = program
    .command("tunnel")
    .description("Manage tunnels across providers");

  cmd
    .command("list")
    .description("List tunnels (optionally filtered by provider)")
    .option("--provider <name>", "Limit to a specific provider")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (opts: CommonFlags) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      await runMultimode<{ tunnels: TunnelRow[] }>({
        mode: pickOutputMode(opts),
        fetchData: () => apiGet<{ tunnels: TunnelRow[] }>(`/${qs}`),
        plain: (result) => {
          if (result.tunnels.length === 0) {
            console.log("No tunnels.");
            return;
          }
          for (const t of result.tunnels) {
            console.log(
              `${t.id}\t${t.providerName}\t${t.status}\t${t.url}\t${t.protocol}:${t.localPort}`,
            );
          }
        },
        interactive: async (result) => {
          if (result.tunnels.length === 0) {
            console.log("No tunnels.");
            return;
          }
          const rows: TableRow[] = result.tunnels.map((t) => ({
            id: String(t.id),
            label: `${t.id} ${t.providerName ?? ""}`.trim(),
            hint: t.status ?? "",
            detail: tunnelDetail(t),
          }));
          await interactiveTable({
            title: `tunnels — ${result.tunnels.length}`,
            rows,
          });
        },
        json: (result) => redactSecrets(result),
      });
    });

  cmd
    .command("get <tunnelId>")
    .description("Get tunnel status")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, opts: CommonFlags) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      await runMultimode<TunnelRow>({
        mode: pickOutputMode(opts),
        fetchData: () => apiGet<TunnelRow>(`/${tunnelId}${qs}`),
        plain: (result) => {
          console.log(JSON.stringify(result, null, 2));
        },
        interactive: async (result) => {
          await interactiveDetail({
            title: `tunnel ${tunnelId}`,
            body: tunnelDetail(result),
          });
        },
        json: (result) => redactSecrets(result),
      });
    });

  cmd
    .command("start <tunnelId>")
    .description("Start a prepared tunnel session")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, opts: CommonFlags) => {
      const result = await apiPost(`/${tunnelId}/start`, {
        provider: opts.provider,
      });
      if (
        maybePrintJson(opts, {
          ok: true,
          action: "start",
          tunnelId,
          result: redactSecrets(result),
        })
      )
        return;
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("stop <tunnelId>")
    .description("Stop an active tunnel")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, opts: CommonFlags) => {
      const result = await apiPost(`/${tunnelId}/stop`, {
        provider: opts.provider,
      });
      if (
        maybePrintJson(opts, {
          ok: true,
          action: "stop",
          tunnelId,
          result: redactSecrets(result),
        })
      )
        return;
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("delete <tunnelId>")
    .description("Delete a tunnel")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, opts: CommonFlags) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      const result = await apiDelete(`/${tunnelId}${qs}`);
      if (
        maybePrintJson(opts, {
          ok: true,
          action: "delete",
          tunnelId,
          result: redactSecrets(result),
        })
      )
        return;
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("sessions <tunnelId>")
    .description("List sessions for a tunnel")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, opts: CommonFlags) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      await runMultimode<unknown>({
        mode: pickOutputMode(opts),
        fetchData: () => apiGet(`/${tunnelId}/sessions${qs}`),
        plain: (result) => {
          console.log(JSON.stringify(result, null, 2));
        },
        interactive: async (result) => {
          const sessions: SessionRow[] = (() => {
            if (
              result &&
              typeof result === "object" &&
              "sessions" in result &&
              Array.isArray((result as { sessions: unknown }).sessions)
            ) {
              return (result as { sessions: SessionRow[] }).sessions;
            }
            return Array.isArray(result) ? (result as SessionRow[]) : [];
          })();
          if (sessions.length === 0) {
            await interactiveDetail({
              title: `sessions — ${tunnelId}`,
              body: "No sessions.",
            });
            return;
          }
          const rows: TableRow[] = sessions.map((s, i) => ({
            id: String(s.id ?? i),
            label: String(s.id ?? `session-${i}`),
            hint: s.status ?? "",
            detail: JSON.stringify(s, null, 2),
          }));
          await interactiveTable({
            title: `sessions — ${tunnelId} (${sessions.length})`,
            rows,
          });
        },
        json: (result) => redactSecrets(result),
      });
    });

  cmd
    .command("status")
    .description("Manager + per-provider health summary")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (opts: OutputFlags) => {
      await runMultimode<unknown>({
        mode: pickOutputMode(opts),
        fetchData: () => apiGet(`/health`),
        plain: (result) => {
          console.log(JSON.stringify(result, null, 2));
        },
        interactive: async (result) => {
          await interactiveDetail({
            title: "tunnel status",
            body: JSON.stringify(result, null, 2),
          });
        },
        json: (result) => redactSecrets(result),
      });
    });

  const providersCmd = cmd
    .command("providers")
    .description("Manage tunnel providers");

  providersCmd
    .command("list")
    .description("List registered tunnel providers and capabilities")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (opts: OutputFlags) => {
      await runMultimode<{ providers: ProviderRow[] }>({
        mode: pickOutputMode(opts),
        fetchData: () => apiGet<{ providers: ProviderRow[] }>(`/providers`),
        plain: (result) => {
          for (const p of result.providers) {
            const star = p.isDefault ? "* " : "  ";
            const ok = p.health.ok ? "ok" : `error (${p.health.message ?? ""})`;
            console.log(`${star}${p.name}\t[${ok}]`);
          }
        },
        interactive: async (result) => {
          if (result.providers.length === 0) {
            await interactiveDetail({
              title: "providers",
              body: "No providers.",
            });
            return;
          }
          const rows: TableRow[] = result.providers.map((p) => ({
            id: String(p.name),
            label: `${p.isDefault ? "* " : "  "}${p.name}`,
            hint: p.health?.ok ? "ok" : "error",
            detail: JSON.stringify(p, null, 2),
          }));
          await interactiveTable({
            title: `providers — ${result.providers.length}`,
            rows,
          });
        },
        json: (result) => redactSecrets(result),
      });
    });

  providersCmd
    .command("set-default <name>")
    .description("Set the default tunnel provider")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (name: string, opts: OutputFlags) => {
      const result = await apiPost(`/default`, { provider: name });
      if (
        maybePrintJson(opts, {
          ok: true,
          action: "set-default",
          provider: name,
          result: redactSecrets(result),
        })
      )
        return;
      console.log(JSON.stringify(result, null, 2));
    });

  const domainsCmd = cmd
    .command("domains")
    .description("Manage custom domains on a tunnel");

  domainsCmd
    .command("add <tunnelId> <domain>")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, domain: string, opts: CommonFlags) => {
      const result = await apiPost(`/${tunnelId}/domains`, {
        domain,
        provider: opts.provider,
      });
      if (
        maybePrintJson(opts, {
          ok: true,
          action: "domains-add",
          tunnelId,
          domain,
          result: redactSecrets(result),
        })
      )
        return;
      console.log(JSON.stringify(result, null, 2));
    });

  domainsCmd
    .command("rm <tunnelId> <domain>")
    .option("--provider <name>")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (tunnelId: string, domain: string, opts: CommonFlags) => {
      const qs = opts.provider
        ? `?provider=${encodeURIComponent(opts.provider)}`
        : "";
      const result = await apiDelete(
        `/${tunnelId}/domains/${encodeURIComponent(domain)}${qs}`,
      );
      if (
        maybePrintJson(opts, {
          ok: true,
          action: "domains-rm",
          tunnelId,
          domain,
          result: redactSecrets(result),
        })
      )
        return;
      console.log(JSON.stringify(result, null, 2));
    });

  cmd
    .command("doctor")
    .description("Diagnose tunnel providers")
    .option("--json", "Emit JSON")
    .option("--plain", "Force plain text output")
    .action(async (opts: OutputFlags) => {
      try {
        await runMultimode<HealthShape>({
          mode: pickOutputMode(opts),
          fetchData: () => apiGet<HealthShape>(`/health`),
          plain: (health) => {
            console.log(`manager: ${health.manager}`);
            for (const p of health.providers) {
              console.log(
                `  ${p.name}: ${p.ok ? "ok" : `fail - ${p.message}`}`,
              );
            }
          },
          interactive: async (health) => {
            const lines: string[] = [`manager: ${health.manager}`];
            for (const p of health.providers) {
              lines.push(`  ${p.name}: ${p.ok ? "ok" : `fail - ${p.message}`}`);
            }
            await interactiveDetail({
              title: "tunnel doctor",
              body: lines.join("\n"),
            });
          },
          json: (health) => redactSecrets(health),
        });
      } catch (err) {
        console.error(`Failed to reach agent: ${err}`);
        process.exitCode = 1;
      }
    });
}
