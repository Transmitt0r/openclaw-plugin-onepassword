/**
 * 1Password exec provider resolver for OpenClaw.
 *
 * Implements the exec provider batching protocol:
 *   stdin:  { "protocolVersion": 1, "provider": "...", "ids": ["id1", "id2", ...] }
 *   stdout: { "protocolVersion": 1, "values": { "id1": "...", "id2": "..." },
 *             "errors": { "idX": { "message": "..." } } }
 *
 * Each SecretRef id IS a complete 1Password reference (op://vault/item/field)
 * — the resolver passes it straight to `op read`. OpenClaw restricts
 * SecretRef ids to /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/ (no spaces), while
 * 1Password item names commonly contain spaces, so the vault/item segments
 * should use their 1Password UUIDs (always alphanumeric, e.g. copy them from
 * `op vault list --format=json` / `op item list --format=json`) rather than
 * their display names wherever those contain disallowed characters.
 *
 * There's deliberately no plugin-level config (vault/field/etc.): OpenClaw
 * has no channel for delivering a plugin's own config to a spawned
 * secretProviderIntegration process (confirmed against both the OpenClaw
 * 2026.7.1 source and its docs — only static, manifest-authored env/passEnv
 * pass through, never plugins.entries.<id>.config), so folding vault/field
 * into the id itself avoids needing one at all.
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

function toOpRef(id: string): string | { error: string } {
  if (!id.startsWith("op://")) {
    return {
      error: `id must be a complete 1Password reference (op://vault/item/field), got "${id}"`,
    };
  }
  return id;
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
  const request = parseRequest(readStdinSync());

  const values: Record<string, string> = {};
  const errors: Record<string, { message: string }> = {};

  for (const id of request.ids) {
    const opRef = toOpRef(id);
    if (typeof opRef !== "string") {
      errors[id] = { message: opRef.error };
      continue;
    }
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
