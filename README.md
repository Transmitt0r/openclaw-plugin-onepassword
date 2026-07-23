# openclaw-plugin-onepassword

[![CI](https://github.com/Transmitt0r/openclaw-plugin-onepassword/actions/workflows/ci.yml/badge.svg)](https://github.com/Transmitt0r/openclaw-plugin-onepassword/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An [OpenClaw](https://docs.openclaw.ai) plugin that provides a **1Password secret provider integration** — batch-resolution of secrets from your vaults via the `op` CLI.

Instead of defining a separate exec provider for every 1Password secret (6+ cold `op` starts at startup), this plugin registers one batched provider that maps SecretRef ids to 1Password items. OpenClaw sends all ids in one stdin request, the resolver calls `op read` for each in sequence, and returns all resolved values in one stdout response.

## Install

```bash
openclaw plugins install clawhub:transmitt0r/openclaw-plugin-onepassword
```

Or for local development, point OpenClaw at a built copy of this repo.

### Prerequisites

- [1Password CLI](https://developer.1password.com/docs/cli/get-started) (`op`) installed on the gateway host
- Service account auth: `OP_SERVICE_ACCOUNT_TOKEN` set in the gateway environment
- Or desktop app integration: the 1Password desktop app running with CLI integration enabled

Verify with `op whoami` from the gateway host.

## Configure

1. Register the plugin and provider:

```json5
{
  plugins: {
    entries: {
      onepassword: {
        config: {
          vault: "Openclaw",  // 1Password vault name
          // field: "credential"  // default, omit unless you use a different field name
          items: {
            // OpenClaw SecretRef ids may only contain letters, digits, and
            // "._:/#-" (no spaces), so item names with spaces need an entry
            // here mapping a valid id to the real item name.
            "openai-api": "OpenAI API",
            "gemini-api": "Gemini API",
            "telegram-bot-token": "Telegram bot token",
          },
        },
      },
    },
  },
  secrets: {
    providers: {
      onepassword: {
        source: "exec",
        pluginIntegration: {
          pluginId: "onepassword",
          integrationId: "secret-store",
        },
      },
    },
    defaults: {
      exec: "onepassword",
    },
  },
}
```

`secrets.defaults.exec: "onepassword"` makes `onepassword` the default provider for `source: "exec"` refs (see [SecretRef docs](https://docs.openclaw.ai/gateway/security) for how `source`/`provider`/`defaults` interact). To name it explicitly instead: `{ source: "exec", provider: "onepassword", id: "..." }`.

2. Replace your inline `op read` providers with SecretRefs:

**Before (6 exec providers):**

```json5
{
  "op-openai": {
    source: "exec",
    command: "/home/openclaw/.local/bin/op-exec",
    args: ["read", "op://Openclaw/OpenAI API/credential"],
    passEnv: ["OP_SERVICE_ACCOUNT_TOKEN"],
    jsonOnly: false,
    timeoutMs: 5000,
  },
  // ... 5 more identical blocks
}
```

**After (one provider, clean refs):**

```json5
{
  models: {
    providers: {
      openai: {
        apiKey: { source: "exec", id: "openai-api" },
      },
      google: {
        apiKey: { source: "exec", id: "gemini-api" },
      },
      // etc.
    },
  },
  channels: {
    telegram: {
      accounts: {
        default: {
          botToken: { source: "exec", id: "telegram-bot-token" },
        },
      },
    },
  },
}
```

`id` must match OpenClaw's [SecretRef id pattern](https://docs.openclaw.ai/gateway/security) (letters, digits, `._:/#-`, no spaces) — since 1Password item names often don't, the resolver looks `id` up in `items` to get the real item name, falling back to the id verbatim if there's no entry. It then builds the reference as `op://<vault>/<item name>/<field>`.

An `items` entry can include a section/field path to override the vault-wide default `field` for just that one secret:

```json5
items: {
  "stripe-key": "Stripe API/token",  // reads the "token" field, not the default "credential"
}
```

## How it works

OpenClaw's exec provider protocol supports batching. The resolver:

1. Receives a JSON request on stdin with all requested `ids`
2. Resolves each id to a 1Password item name via `config.items` (falling back to the id itself), then maps it to a reference via `op://<vault>/<item name>/<field>`
3. Calls `op read --no-newline` for each (sequential — `op` has no batch-read)
4. Returns a JSON response on stdout with all resolved values

```json5
// stdin
{"protocolVersion":1,"provider":"onepassword","ids":["openai-api","gemini-api","brave-search"]}

// stdout
{"protocolVersion":1,"values":{"openai-api":"sk-...","gemini-api":"...","brave-search":"..."}}
```

Per-id errors are returned as `errors` entries without aborting the whole batch.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, commit conventions, and how releases work.