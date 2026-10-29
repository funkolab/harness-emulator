# Harness Emulator

A chat interface in the style of an AI coding agent, for reliable live demonstrations. Every answer is scripted in YAML: reasoning steps, MCP tool calls and the final response are replayed with realistic timing. No LLM, MCP server, API key or Internet access is needed, so the demo behaves the same way every time.

The browser only shows the conversation. Scenario names, matching rules and other demonstration controls stay on the server.

> **Not affiliated with OpenCode.** This project imitates the look of the [OpenCode](https://opencode.ai) interface for demonstration purposes. It is not an official OpenCode product and is not endorsed by its authors.

## How it works

1. You describe the menus (agents, models, reasoning levels, MCP servers, commands) in `config.yaml`.
2. You write one YAML scenario per expected question in `scenarios/`.
3. When a participant submits a question, the server picks the matching scenario using the selected agent and enabled MCP servers, then streams its events to the browser.

## Quick start

Build from source (see [Build from source](#build-from-source)), then run the binary from the project directory:

```sh
./release/darwin-arm64/harness-emulator --config ./config.yaml
# On Linux x64:
# ./release/linux-x64/harness-emulator --config ./config.yaml
```

Open **http://127.0.0.1:4097** in a browser and try one of the `example` questions from the files in `scenarios/`. Press Ctrl+C to stop the server.

The server listens only on `127.0.0.1`. Port 4097 avoids conflicting with an OpenCode instance on 4096.

## Run the standalone binary

The binary embeds the interface and the Bun runtime. **The demonstration machine does not need Node, Bun or npm.** Choose the binary matching its operating system and architecture. Each distribution contains only the binary; keep the configuration and scenarios next to it or anywhere you like.

Default locations:

- `scenarios/` is read from the **current working directory**.
- `config.yaml` is read from the **directory containing the binary**, even when it is launched through a symbolic link or the `PATH`.

Override them with options:

```sh
/path/to/harness-emulator --port 8080
/path/to/harness-emulator --scenarios /path/to/scenarios
/path/to/harness-emulator --config /path/to/config.yaml
/path/to/harness-emulator --check
/path/to/harness-emulator --help
```

Relative paths are resolved from the current working directory. `--check` validates the configuration and every scenario file, then exits with a nonzero status on errors. Configuration errors appear in the terminal; the browser only shows a generic "service unavailable" message.

## HTTPS

Use `--tls` to serve HTTPS instead of HTTP. TLS defaults to port 443; use `--port` to override it. Without `--tls`, HTTP still defaults to 4097. The server continues to listen only on `127.0.0.1`.

```sh
./release/darwin-arm64/harness-emulator --config ./config.yaml --tls --port 8443
```

By default, TLS reads `cert.pem` and `key.pem` from the current working directory. Supply other PEM paths with `--tls-cert` and `--tls-key`:

```sh
sudo ./release/darwin-arm64/harness-emulator --config ./config.yaml --tls \
  --tls-cert /path/to/cert.pem --tls-key /path/to/key.pem
```

Open `https://demo.example.com/` when using port 443, or `https://demo.example.com:8443/` for the first example, replacing the hostname with your own. On systems requiring administrator privileges for low ports, use `sudo` for 443 or choose a higher port.

Provide a certificate valid for the hostname you use (for example `demo.example.com`) and trusted by your browser. The application does not generate certificates or install a trusted certificate authority. A self-signed certificate enables encryption but still produces a browser trust warning unless explicitly trusted. Keep the private key outside release folders; packaging does not include certificates or keys.

`--tls --check` also validates that the certificate and private key can be loaded together. Missing, malformed or mismatched TLS files stop startup with a terminal error. Restart after replacing TLS files. Enabling HTTPS does not start a separate HTTP listener or redirect HTTP traffic.

## Configure the menus

Pass the configuration file with `--config`. Without that option, the binary looks for `config.yaml` in its own directory, and development mode uses the project directory:

```yaml
version: 1
agents: [Architect, Developer, Analyst]
models:
  - name: Atlas
    provider: OpenAI
  - name: Orion
    provider: Nutanix Enterprise AI
  - name: Fast model
    provider: Nutanix Enterprise AI
reasoningLevels: [Default, Low, Medium, High]
defaults:
  agent: Architect
  model: Atlas
  reasoningLevel: Default
project: work
branch: main
```

The model picker opens above the selector, with search by model or provider and provider groups. `models` accepts `name` / `provider` objects or simple names (`models: [Atlas, Orion]`). Simple names appear under the generic Models group.

“Manage models” shows or hides models in the current browser, keeping at least one visible. These preferences do not change the configuration file. Hiding the selected model selects the first remaining visible model. Arrow keys navigate search results, Enter selects, and Escape or an outside click closes the picker.

Agent, model and reasoning lists must be nonempty and contain unique names, each up to 100 characters. Each `defaults` value must belong to its corresponding list. Omitting `defaults` selects the first item in each list. `project` and `branch` are optional.

Configuration is read on page load and before each question. **Reload the browser after editing the file** to update the menus. Submitting a selection removed from the configuration asks the user to reload. Previous responses retain the selections used when they were sent.

The configuration file is optional. Without it, the application uses Plan/Build, GPT-5.6 Terra Fast and Default/Low/Medium/High. An invalid file produces an error rather than falling back silently. The configuration size limit is 64 KiB.

## Commands

Typing `/` at the start of the input opens the command palette above it. Results filter by name and description while typing. Arrow keys navigate, Enter selects, and Escape closes; clicking also selects. Selecting a custom command closes the palette and clears the input without submitting a request or adding a conversation turn.

`/new` immediately opens a new session in an additional tab while retaining history. The top + button does the same. `/mcp` opens the MCP server dialog. These built-in names cannot be overridden.

Add commands to `config.yaml`, then reload the browser:

```yaml
commands:
  - name: projects
    description: Search current projects
  - name: diagnostic
    description: Run diagnostics
```

Each command has **one optional `description` string**, displayed exactly as configured in every browser language. Built-in command descriptions follow the browser language.

Names accept ASCII letters, digits, hyphens and underscores, up to 64 characters, with an optional leading `/`. Names are normalized to lowercase and must be unique. Descriptions have a 1,000-character limit. Custom commands cannot define `action`.

Additional commands are decorative menu entries only. Selecting or submitting them never runs a prompt, calls a tool or selects a scenario. Direct API submissions of configured slash commands return HTTP 204 with no response content. Only the built-in `/new` and `/mcp` commands perform actions in the interface.

Scenario events support `{{prompt}}`, `{{agent}}`, `{{model}}` and `{{reasoningLevel}}`, using the request and selections captured at submission.

## MCP servers

Define available servers in `config.yaml`, then reload the browser:

```yaml
mcpServers:
  - name: github
    enabled: false
  - name: github via NAI
    enabled: false
  - name: nutanix-official
    enabled: true
```

Simple names are also accepted (`mcpServers: [github, notion]`) and start disabled. `enabled` is optional and defaults to `false`. Names must be unique and at most 100 characters long. Without servers, the dialog displays an empty state.

In `/mcp`, enabling a server displays “connecting…” for 1.2 seconds, then “connected”. The switch remains off and disabled during the delay. Disabling is immediate. Closing the dialog cancels pending activations. The active count includes all servers, even when search filters the list. Browser preferences (`harness-emulator.mcpStates`) override initial configuration states. Close the dialog with its cross, Escape or a background click.

These virtual states do not start connections. They accompany each question and can select a scenario through `when.mcp`. The YAML files are not modified.

## Create scenarios

Create a `.yaml` or `.yml` file in `scenarios/`. Files are reread **before every question**, without restarting. They load alphabetically, with **exactly one scenario per file**. IDs must be unique across the folder, and each file has a 1 MiB size limit.

Keep `version: 1` and place `id`, `name`, optional `when`, `matcher` and `events` directly at the root:

```yaml
version: 1
id: document-search
name: Document search
matcher:
  type: contains
  value: documents
  caseSensitive: false
events:
  - type: thinking
    title: Prepare the search
    content: I will search for relevant documents.
    duration: 800
  - type: tool
    server: notion
    name: search
    input:
      query: "{{prompt}}"
    output:
      results: [Document A, Document B]
    duration: 1200
    status: success
  - type: final
    content: "I found **two documents**."
    delay: 200
    duration: 800
```

A scenario can require particular states of servers defined in `config.yaml`:

```yaml
version: 1
id: github-projects
name: GitHub projects
when:
  mcp:
    github: true
    github via NAI: false
matcher: { type: contains, value: projects }
events:
  - type: final
    content: Here are the projects found on GitHub.
```

`true` requires an enabled server; `false` requires a disabled one. All conditions must match. Server names must match `mcpServers` exactly; unknown names are rejected during loading and by `--check`. Without `when`, a scenario is independent of MCP state.

States are captured at submission. A pending activation counts as disabled; later changes do not affect a running response. The API accepts `mcpStates: {github: true}`; omitted states use their initial configuration values.

Selection priority is:

1. The first matching specific scenario with satisfied MCP conditions.
2. The first matching specific scenario without conditions.
3. The highest-scoring eligible `fuzzy` scenario above its threshold.
4. The first `always` scenario with satisfied conditions.
5. The first unconditional `always` scenario.

For specific and fallback matchers, alphabetical file order determines priority. Fuzzy ties prefer a scenario with MCP conditions, then alphabetical file order. If nothing matches, the assistant asks for clarification. Add `matcher: { type: always }` to customize this fallback.

`when.mcpAny` requires at least one enabled server from a nonempty list of unique configured names. It combines with `when.agent` and `when.mcp`; all these conditions must be satisfied. `{{mcpServer}}` in events resolves to the first enabled server in that list, so tool events show **github via NAI** when only that server is enabled and **github** when both are enabled.

- `matcher.type`: `contains`, `exact`, `regex`, `fuzzy` or `always`. Matching is case-insensitive by default.
- `events`: `thinking`, `tool`, `message` or `final`. The sequence must end with `final`.
- `delay`: wait before an event. `duration`: progressive text or tool duration. Both use milliseconds from 0 to 60,000 and default to zero.
- `content`: Markdown. `title`: optional reasoning title.
- Tool fields: `server`, `name`, `input`, `output`, `status` (`success` or `error`). Inputs and outputs may contain YAML objects.
- Template variables also work inside nested objects.
- `name`, `description` and `example` are operator metadata and do not appear in the participant interface.
- `regex` matchers come from operator-controlled files and run on every question. Keep them simple to avoid slow, catastrophic backtracking patterns.

## Agent conditions

Restrict a scenario to one configured agent using `when.agent`:

```yaml
when:
  agent: Build
  mcp:
    nutanix-official: true
```

`agent` can be used alone or combined with `mcp`; all conditions must match. The name must exactly match an entry in `config.yaml`'s `agents` list, including case. Use the configured identifier rather than its translated display label. Unknown agents are rejected by `--check` and when loading scenarios.

The selected agent is captured at submission, using the configured default when omitted from an API request. Scenarios without `when.agent` remain available to all agents. Agent conditions use the same selection priorities as MCP conditions, including fuzzy matching and fallback scenarios.

## Fuzzy matching

Use keywords to tolerate spelling mistakes and varied phrasing:

```yaml
matcher:
  type: fuzzy
  keywords:
    - [create, provision]
    - [VM, virtual machine]
  threshold: 0.7
```

Each list entry is one equally weighted keyword group; a nested list contains alternatives for that group. The score is the average of each group's best match in the question, from 0 to 1. Missing groups score zero. Keyword groups may appear in any order; words within a phrase must be consecutive. A score at or above `threshold` qualifies (default 0.7; allowed range greater than 0 through 1).

Matching ignores case, accents and punctuation by default. `caseSensitive: true` preserves case. Word similarity uses normalized edit distance; similarities below 0.6 count as zero. Words of three characters or fewer, such as VM, require an exact token match to avoid accidental matches. Synonyms must be listed explicitly.

Agent and MCP conditions filter candidates first. Existing specific matchers retain priority over fuzzy matches; fuzzy matches are ranked by score before the `always` fallback. Tied scores prefer conditioned scenarios, then file order.

Limits: 32 keyword groups, 16 alternatives per group and 200 characters per alternative. Comparison uses the first 256 question tokens and caps each token at 64 characters. Tune keywords and thresholds against your demonstration questions.

## Sessions and browser storage

Each session has an individual closable top tab. Closing a tab retains its session in the left history panel. Selecting it there reopens the tab without duplicating an already open one. Closing the last tab creates a new empty session. Open tabs, the active session and drafts are restored after reloading. Stop a running response before changing sessions or closing its active tab.

Sessions are stored in the browser's `localStorage` under `harness-emulator.sessions.v2`; tab state uses `harness-emulator.tabs.v1`. No session files are written beside the binary. Storage belongs to the browser profile and origin, including the localhost port.

The history panel includes “Delete all sessions”. Its confirmation dialog removes conversations, drafts and tabs from the current browser, then opens a new empty session. Model preferences and MCP states remain. Deletion is unavailable while a response is running.

Enter sends, Shift+Enter inserts a new line, and the square stop button interrupts the response and closes the server stream. Tool and reasoning details can be expanded. Attachments appear for presentation but are neither uploaded nor analyzed. Agent, model and reasoning selections are virtual; YAML defines the responses, optionally using their template variables. The application reproduces a demonstration flow, not every feature of a real coding agent.

## Interface languages

The interface follows preferred browser languages (`navigator.languages`) in order: French (`fr`, `fr-FR`, etc.) or English (`en`, `en-US`, etc.). If neither is found, it uses English. Reload after changing browser language preferences.

Buttons, menus, states, placeholders, confirmations and error messages are translated. Scenario text, explicit reasoning titles and tool results stay unchanged. Custom command descriptions are plain strings and remain exactly as configured. Server, model, project and command names retain their configured identity. Common agent and reasoning labels (Default/Défaut, Architect/Architecte, Analyst/Analyste…) are displayed in the browser language whichever language is used in `config.yaml`; the identifiers sent to the server stay unchanged.

Interface strings are written in English in the source code; French translations live in `src/i18n.ts`.

## Build from source

Use [mise](https://mise.jdx.dev/) to manage the project toolchain and tasks. `mise.toml` pins Bun 1.4.2. Bun manages dependency installation, TypeScript execution, tests, development and packaging. Node.js, npm and tsx are not required. Dependencies are locked in `bun.lock` and installed with `bun install --frozen-lockfile`. Packaging uses [Bun standalone executables](https://bun.sh/docs/bundler/executables).

```sh
mise trust
mise install
mise run deps
mise run check
mise run package
```

Only the native binary is placed in `release/darwin-arm64/` or `release/linux-x64/`. Only macOS Apple Silicon and Linux x64 are supported. A `.tar.gz` archive of each folder is also created, containing only the binary. Configuration and scenarios are not copied into distributions.

```sh
# Build both supported distributions.
mise run package:all

# Build one target.
mise run package:linux
```

Packaging automatically removes temporary `.*.bun-build` files from the project root before building and on completion, including compilation failures.

Cross-compilation downloads the corresponding runtime when needed. Linux binaries use glibc. macOS binaries are unsigned and not notarized.

## Development

```sh
mise run dev -- --port 5173
```

The API server listens on 4098 and Vite on 5173 with an `/api` proxy. In development, `config.yaml` and `scenarios/` are read from the project directory. Tasks run with the pinned tool versions without requiring shell activation. Dependency installation runs automatically when a task needs it and is skipped when the package manifests and installation marker are unchanged.

| Task                         | Purpose                                                      |
|------------------------------|--------------------------------------------------------------|
| `mise run deps` (or `setup`) | Install dependencies with `bun install --frozen-lockfile`    |
| `mise run dev`               | Start development servers; extra CLI arguments are forwarded |
| `mise run typecheck`         | Check TypeScript                                             |
| `mise run build`             | Check TypeScript and build the interface                     |
| `mise run test`              | Run tests, including HTTP and HTTPS                          |
| `mise run scenarios`         | Validate configuration and scenario files                    |
| `mise run lint`              | Check formatting and lint rules with Biome                   |
| `mise run format`            | Format and apply safe lint fixes with Biome                  |
| `mise run check`             | Run lint, type checking, tests and scenario validation       |
| `mise run package`           | Package the current supported platform                       |
| `mise run package:all`       | Package both supported platforms                             |
| `mise run package:macos`     | Package macOS Apple Silicon                                  |
| `mise run package:linux`     | Package Linux x64                                            |

Use `mise tasks --local` to list project tasks. The same scripts are available directly through `bun run dev`, `bun run build`, `bun test` and `bun run package:all`. Vite and TypeScript are explicitly run with Bun. OpenSSL is needed for HTTPS integration tests; mise manages Bun, while OpenSSL is supplied by the operating system. The standalone application itself does not require mise or development dependencies.

## Contributing

Issues and pull requests are welcome. Before submitting a change:

```sh
mise run format
mise run check
```

The code is formatted and linted with [Biome](https://biomejs.dev/) (`biome.json`). Write code, comments, test names and interface strings in English, and add the French translation of any new interface string to `src/i18n.ts`. Do not commit real infrastructure names, addresses, identifiers or private repository data in scenarios.

## License

Licensed under the [Apache License 2.0](LICENSE).
