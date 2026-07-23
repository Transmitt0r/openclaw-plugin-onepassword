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
 * OpenClaw restricts SecretRef ids to /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/
 * (no spaces), while 1Password item names commonly contain spaces. When an
 * item name isn't itself a valid id, map a valid id to the real item name via
 * config.items (e.g. { "brave-search": "Brave search" }).
 *
 * Config is injected by the OpenClaw plugin host via environment variable
 * OPENCLAW_PLUGIN_CONFIG as JSON.
 */

import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";

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
  items: Record<string, string>;
}

function loadConfig(): PluginConfig {
  const raw = process.env.OPENCLAW_PLUGIN_CONFIG;
  if (!raw) {
    process.stderr.write("onepassword resolver: OPENCLAW_PLUGIN_CONFIG is not set\n");
    process.exit(1);
  }
  try {
    const config = JSON.parse(raw) as Partial<PluginConfig>;
    if (!config.vault || typeof config.vault !== "string") {
      process.stderr.write("onepassword resolver: config.vault is required\n");
      process.exit(1);
    }
    return {
      vault: config.vault,
      field: config.field || "credential",
      items: config.items && typeof config.items === "object" ? config.items : {},
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
  // config.items maps a valid SecretRef id to the real 1Password item name
  // (needed whenever the item name itself isn't a valid id, e.g. it has
  // spaces). Falls back to using the id verbatim as the item name/path.
  const target = config.items[id] ?? id;
  // The target can contain slashes (e.g. "OpenAI/credential"). If it already
  // looks like a full 1Password path (contains a second segment like
  // "item/section/field"), use it as-is; otherwise append /<field>.
  const segments = target.split("/").filter(Boolean);
  if (segments.length >= 2) {
    // target already includes item and section/field — use directly
    return `op://${vault}/${target}`;
  }
  // target is just the item name — append config.field
  return `op://${vault}/${target}/${config.field}`;
}

function readStdinSync(): string {
  // exec provider protocol: request arrives as a single write on stdin.
  // Use synchronous fd read because the pipe is closed after one write.
  const chunks: Buffer[] = [];
  try {
    const fd = process.stdin.fd;
    const buf = Buffer.alloc(65536);
    let bytesRead = readSync(fd, buf, 0, buf.length, null);
    while (bytesRead > 0) {
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      bytesRead = readSync(fd, buf, 0, buf.length, null);
    }
  } catch {
    // stdin may already be closed (no data), which is fine for 0 ids
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

function main(): void {
  const config = loadConfig();
  const request = parseRequest(readStdinSync());

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

main();
