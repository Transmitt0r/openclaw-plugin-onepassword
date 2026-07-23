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
        apiKey: { source: "exec", id: "OpenAI API" },
      },
      google: {
        apiKey: { source: "exec", id: "Gemini API" },
      },
      // etc.
    },
  },
  channels: {
    telegram: {
      accounts: {
        default: {
          botToken: { source: "exec", id: "Telegram bot token" },
        },
      },
    },
  },
}
```

The `id` maps to a 1Password item in your vault. The resolver builds the full reference as:

```
op://<vault>/<id>/<field>
```

If the `id` already contains slashes (e.g. `OpenAI API/credential`), it's used as the full item path within the vault — the configured `field` is only appended when the id is a plain item name.

## How it works

OpenClaw's exec provider protocol supports batching. The resolver:

1. Receives a JSON request on stdin with all requested `ids`
2. Maps each id to a 1Password reference via `op://<vault>/<id>/<field>`
3. Calls `op read --no-newline` for each (sequential — `op` has no batch-read)
4. Returns a JSON response on stdout with all resolved values

```json5
// stdin
{"protocolVersion":1,"provider":"onepassword","ids":["OpenAI API","Gemini API","Brave search"]}

// stdout
{"protocolVersion":1,"values":{"OpenAI API":"sk-...","Gemini API":"...","Brave search":"..."}}
```

Per-id errors are returned as `errors` entries without aborting the whole batch.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, commit conventions, and how releases work.