/**
 * 1Password exec provider resolver for OpenClaw.
 *
 * Implements the exec provider batching protocol:
 *   stdin:  { "protocolVersion": 1, "provider": "...", "ids": ["id1", "id2", ...] }
 *   stdout: { "protocolVersion": 1, "values": { "id1": "...", "id2": "..." },
 *             "errors": { "idX": { "message": "..." } } }
 *
 * Each SecretRef id maps to a 1Password reference:
 *   op://<vault>/<id>/<field>
 *
 * Config is injected by the OpenClaw plugin host via environment variable
 * OPENCLAW_PLUGIN_CONFIG as JSON.
 */

import { spawnSync } from "node:child_process";

interface ProtocolRequest {
  protocolVersion: number;
  provider: string;
  ids: string[];
}

interface ProtocolResponse {
  protocolVersion: number;
  values: Record<string, string>;
  errors?: Record<string, { message: string }>;
}

interface PluginConfig {
  vault: string;
  field: string;
}

function loadConfig(): PluginConfig {
  const raw = process.env.OPENCLAW_PLUGIN_CONFIG;
  if (!raw) {
    process.stderr.write("onepassword resolver: OPENCLAW_PLUGIN_CONFIG is not set\n");
    process.exit(1);
  }
  try {
    const config = JSON.parse(raw) as PluginConfig;
    if (!config.vault || typeof config.vault !== "string") {
      process.stderr.write("onepassword resolver: config.vault is required\n");
      process.exit(1);
    }
    return {
      vault: config.vault,
      field: config.field || "credential",
    };
  } catch (err) {
    process.stderr.write(
      `onepassword resolver: failed to parse OPENCLAW_PLUGIN_CONFIG: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(1);
  }
}

function buildOpRef(config: PluginConfig, id: string): string {
  const vault = config.vault.startsWith("op://") ? config.vault.slice(5) : config.vault;
  // The id from the SecretRef can contain slashes (e.g. "OpenAI/credential").
  // If the id already looks like a full 1Password path (contains a second
  // segment like "item/section/field"), use it as-is; otherwise append
  // /<field>.
  const segments = id.split("/").filter(Boolean);
  if (segments.length >= 2) {
    // id already includes item and section/field — use directly
    return `op://${vault}/${id}`;
  }
  // id is just the item name — append config.field
  return `op://${vault}/${id}/${config.field}`;
}

async function readStdin(): Promise<string> {
  // Async iteration is the standard, backpressure-safe way to drain a
  // readable stream to EOF. A prior version used a hand-rolled synchronous
  // readSync() loop on process.stdin.fd, which is fragile for pipes: a
  // non-blocking pipe fd can throw EAGAIN mid-write before the parent has
  // finished sending the request, and the loop's catch-all treated that as
  // "done," silently truncating the JSON payload and crashing on parse.
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim() || "{}";
}

function parseRequest(raw: string): ProtocolRequest {
  try {
    return JSON.parse(raw) as ProtocolRequest;
  } catch (err) {
    process.stderr.write(
      `onepassword resolver: failed to parse stdin request: ${err instanceof Error ? err.message : err}\n`,
    );
    process.exit(1);
  }
}

function writeResponse(response: ProtocolResponse): void {
  process.stdout.write(JSON.stringify(response));
}

function readOpSecret(opRef: string): string | { error: string } {
  const result = spawnSync("op", ["read", "--no-newline", opRef], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      HOME: process.env.HOME || "/root",
    },
  });

  if (result.status === 0) {
    return result.stdout.trim();
  }

  const stderr = result.stderr?.trim() || `op exited with status ${result.status}`;
  if (result.error) {
    return { error: `op failed: ${result.error.message}` };
  }
  return { error: stderr };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const request = parseRequest(await readStdin());

  const values: Record<string, string> = {};
  const errors: Record<string, { message: string }> = {};

  for (const id of request.ids) {
    const opRef = buildOpRef(config, id);
    const result = readOpSecret(opRef);
    if (typeof result === "string") {
      values[id] = result;
    } else {
      errors[id] = { message: result.error };
    }
  }

  writeResponse({
    protocolVersion: 1,
    values,
    ...(Object.keys(errors).length > 0 ? { errors } : {}),
  });
}

main().catch((err) => {
  process.stderr.write(
    `onepassword resolver: unhandled error: ${err instanceof Error ? err.message : err}\n`,
  );
  process.exit(1);
});
