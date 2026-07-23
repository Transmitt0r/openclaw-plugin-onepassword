import { describe, expect, it } from "vitest";

// The resolver is designed to be spawned as a child process by OpenClaw.
// We test the pure functions that don't touch stdin/stdout or spawn op.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildOpRef(
  config: { vault: string; field: string; items?: Record<string, string> },
  id: string,
): string {
  const vault = config.vault.startsWith("op://") ? config.vault.slice(5) : config.vault;
  const target = config.items?.[id] ?? id;
  const segments = target.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return `op://${vault}/${target}`;
  }
  return `op://${vault}/${target}/${config.field}`;
}

describe("buildOpRef", () => {
  const config = { vault: "Openclaw", field: "credential" };

  it("appends field for plain item names", () => {
    expect(buildOpRef(config, "OpenAI-API")).toBe("op://Openclaw/OpenAI-API/credential");
  });

  it("uses id as-is when it already contains sections", () => {
    expect(buildOpRef(config, "OpenAI-API/credential")).toBe("op://Openclaw/OpenAI-API/credential");
  });

  it("handles op:// prefix in vault config", () => {
    expect(buildOpRef({ vault: "op://Openclaw", field: "credential" }, "brave-search")).toBe(
      "op://Openclaw/brave-search/credential",
    );
  });

  it("handles custom field", () => {
    expect(buildOpRef({ vault: "Openclaw", field: "password" }, "some-item")).toBe(
      "op://Openclaw/some-item/password",
    );
  });

  it("handles empty field for multi-segment ids", () => {
    expect(buildOpRef({ vault: "Openclaw", field: "" }, "Deep/Path/Field")).toBe(
      "op://Openclaw/Deep/Path/Field",
    );
  });

  it("maps a valid slug id to a real item name via config.items", () => {
    expect(
      buildOpRef({ ...config, items: { "brave-search": "Brave search" } }, "brave-search"),
    ).toBe("op://Openclaw/Brave search/credential");
  });

  it("falls back to the id verbatim when no items mapping matches", () => {
    expect(buildOpRef({ ...config, items: { "brave-search": "Brave search" } }, "gemini-api")).toBe(
      "op://Openclaw/gemini-api/credential",
    );
  });

  it("supports an items mapping that points at a full item/section/field path", () => {
    expect(
      buildOpRef({ ...config, items: { "openai-api": "OpenAI API/credential" } }, "openai-api"),
    ).toBe("op://Openclaw/OpenAI API/credential");
  });

  it("lets an items mapping override the field per-secret", () => {
    expect(
      buildOpRef({ ...config, items: { "stripe-key": "Stripe API/token" } }, "stripe-key"),
    ).toBe("op://Openclaw/Stripe API/token");
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
