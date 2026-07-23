import { describe, expect, it } from "vitest";

// The resolver is designed to be spawned as a child process by OpenClaw.
// We test the pure functions that don't touch stdin/stdout or spawn op.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildOpRef(
  config: { vault: string; field: string; items: Record<string, string> },
  id: string,
): string | { error: string } {
  const itemName = config.items[id];
  if (!itemName) {
    return { error: `no config.items entry for id "${id}"` };
  }
  const vault = config.vault.startsWith("op://") ? config.vault.slice(5) : config.vault;
  return `op://${vault}/${itemName}/${config.field}`;
}

describe("buildOpRef", () => {
  const config = {
    vault: "Openclaw",
    field: "credential",
    items: { "brave-search": "Brave search" },
  };

  it("maps id to its item name via config.items", () => {
    expect(buildOpRef(config, "brave-search")).toBe("op://Openclaw/Brave search/credential");
  });

  it("handles op:// prefix in vault config", () => {
    expect(buildOpRef({ ...config, vault: "op://Openclaw" }, "brave-search")).toBe(
      "op://Openclaw/Brave search/credential",
    );
  });

  it("handles custom field", () => {
    expect(buildOpRef({ ...config, field: "password" }, "brave-search")).toBe(
      "op://Openclaw/Brave search/password",
    );
  });

  it("returns an error for an id with no items entry", () => {
    expect(buildOpRef(config, "unmapped-id")).toEqual({
      error: 'no config.items entry for id "unmapped-id"',
    });
  });
});

describe("manifest structure", () => {
  it("declares a secret-store integration", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, "..", "openclaw.plugin.json"), "utf8"),
    );
    expect(manifest.contracts.secretProviderIntegrations).toBeDefined();
    expect(manifest.contracts.secretProviderIntegrations["secret-store"]).toBeDefined();
    expect(manifest.contracts.secretProviderIntegrations["secret-store"].jsonOnly).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: testing literal `${node}` manifest value
    expect(manifest.contracts.secretProviderIntegrations["secret-store"].command).toBe("${node}");
  });
});

describe("package file list", () => {
  it("includes dist, skills, and manifest in the published tarball", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("skills");
    expect(pkg.files).toContain("openclaw.plugin.json");
  });

  it("lists openclaw-plugin as a keyword", () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8"));
    expect(pkg.keywords).toContain("openclaw-plugin");
    expect(pkg.keywords).toContain("1password");
  });
});
