To get all of these terminal coding agents speaking **A2A v1.0**, you need to solve two separate problems for each agent:

1. **Outbound (A2A Client):** Letting the CLI discover remote Agent Cards and send tasks to other agents.
2. **Inbound (A2A Server):** Wrapping the CLI in an HTTP/JSON-RPC server that advertises a `/.well-known/agent-card.json` endpoint so other agents can delegate tasks *to* it.

There is a **universal shortcut** for both directions before looking at agent-specific extensions:

- **Universal Client (`a2a-cli` + Skill):** The official Linux Foundation [A2A CLI](https://a2a-protocol.org/latest/blog/2026/10/01/introducing-a2a-cli/) provides a single `a2a` binary (`a2a card get`, `a2a send`, `a2a task`) and a universal `SKILL.md` (`npx skills add https://github.com/a2aproject/a2a-cli --skill a2a-cli`) that works across Claude Code, Codex, Antigravity CLI, Gemini CLI, and Pi.
- **Universal MCP Bridge (`a2anet-mcp`):** Any agent that supports MCP can attach [a2anet-mcp](https://github.com/a2anet/a2a-mcp) (`uvx a2anet-mcp`) to turn remote A2A agents into standard MCP tools (`get_agents`, `send_message`, `get_task`). [[1](https://github.com/a2anet/a2a-mcp), [2](https://github.com/akillness/jeo-skills), [3](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c), [4](https://a2a-protocol.org/latest/blog/2026/10/01/introducing-a2a-cli/)]

The specific setup for each coding agent is detailed below.

------

1. Pi Coding Agent (`pi`)

Pi has the richest native-feeling A2A ecosystem because its extension runtime can spin up background HTTP servers and register custom LLM tools directly inside the agent loop. [[1](https://github.com/DrOlu/pi-a2a-communication), [2](https://pi.dev/packages/@bacnh85/pi-a2a)]

- **Bidirectional Setup (Client + Server):** Install the [`@bacnh85/pi-a2a`](https://pi.dev/packages/@bacnh85/pi-a2a) package: [[1](https://pi.dev/packages/@bacnh85/pi-a2a)]

  bash

  ```
  pi install npm:@bacnh85/pi-a2a
  ```

  Use code with caution.

  

- **How Outbound Works:** Pi gains LLM-callable tools and `/a2a-*` slash commands to discover `/.well-known/agent-card.json` endpoints, stream SSE progress, and chain tasks across remote A2A servers. [[1](https://pi.dev/packages/pi-a2a-adaptor), [2](https://pi.dev/packages/@bacnh85/pi-a2a)]

- **How Inbound Works:** Enable the inbound server globally in `~/.pi/agent/settings.json` or via `A2A_SERVER_ENABLED=true`. When an external agent sends an A2A task to Pi's port, the extension spawns an isolated Pi session (`createAgentSession`) in your workspace, executes the code changes, and returns the result as an A2A task artifact without interrupting your active TUI. *(Note: For zero-config LAN discovery via mDNS, you can alternatively use [`pi-a2a`](https://pi.dev/packages/pi-a2a?page=29).)* [[1](https://pi.dev/packages/pi-a2a?page=29), [2](https://pi.dev/packages/@bacnh85/pi-a2a)]

------

2. Claude Code (`claude`)

Claude Code uses MCP bridges or Agent Skills for outbound calls and a dedicated SDK wrapper to act as an A2A server. [[1](https://github.com/ericabouaf/claude-a2a), [2](https://mcpmarket.com/server/a2a-bridge), [3](https://mcpmarket.com/tools/skills/a2a-agent-communication)]

- **Outbound Setup (Client):**

  - **Option A (MCP Bridge):** Add `a2anet-mcp` to `~/.claude.json` so Claude sees remote A2A agents as native tools:

    json

    ```
    {
      "mcpServers": {
        "a2a": {
          "command": "uvx",
          "args": ["a2anet-mcp"],
          "env": {
            "A2A_MCP_AGENT_CARDS": "{\"worker-agent\": {\"url\": \"http://localhost:3008/.well-known/agent-card.json\"}}"
          }
        }
      }
    }
    ```

    Use code with caution.

  - **Option B (A2A CLI Skill):** Install the `a2a` binary and place the `a2a-cli` skill into `~/.claude/skills/` so Claude invokes `a2a send --stream` via its Bash tool. [[1](https://a2a-protocol.org/latest/blog/2026/10/01/introducing-a2a-cli/), [2](https://github.com/a2anet/a2a-mcp), [3](https://github.com/akillness/jeo-skills), [4](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c)]

  

- **Inbound Setup (Server):** Run [`claude-a2a`](https://github.com/ericabouaf/claude-a2a), which wraps the Claude Agent SDK in an A2A v1.0 JSON-RPC server (defaulting to port `3008`).

  - Configure `.claude/claude-a2a.config.json` in your target repository with your allowed tools (`Read`, `Write`, `Edit`), `permissionMode` (e.g., `acceptEdits`), and `publicUrl`.
  - It automatically maps incoming A2A `contextId` values to persistent local Claude `session_id` states so multi-turn A2A follow-ups retain full codebase context. [[1](https://github.com/ericabouaf/claude-a2a)]

  

------

3. OpenAI Codex CLI (`codex`)

Codex CLI relies on its global `config.toml` for outbound MCP bridging and a Python SDK adapter for inbound A2A hosting. [[1](https://github.com/hybroai/a2a-adapter/blob/main/examples/codex_agent.py), [2](https://www.youtube.com/watch?v=sYtNcR9zXvk), [3](https://github.com/a2anet/a2a-mcp)]

- **Outbound Setup (Client):**

  - **Option A (MCP Bridge in `~/.codex/config.toml`):** Register `a2anet-mcp` as an MCP server in Codex's TOML config:

    toml

    ```
    [mcp_servers.a2a]
    command = "uvx"
    args = ["a2anet-mcp"]
    
    [mcp_servers.a2a.env]
    A2A_MCP_AGENT_CARDS = '{"claude-worker": {"url": "http://localhost:3008/.well-known/agent-card.json"}}'
    ```

    Use code with caution.

  - **Option B (Shared Agent Skill):** Install the `a2a-cli` skill into `~/.agents/skills/` (Codex's global skills directory) so Codex can drive the `a2a` CLI directly. [[1](https://github.com/a2anet/a2a-mcp), [2](https://www.youtube.com/watch?v=sYtNcR9zXvk), [3](https://github.com/akillness/jeo-skills), [4](https://a2a-protocol.org/latest/blog/2026/10/01/introducing-a2a-cli/)]

  

- **Inbound Setup (Server):** Use [`a2a-adapter`](https://github.com/hybroai/a2a-adapter/blob/main/examples/codex_agent.py) (`CodexAdapter`), which wraps `@openai/codex` behind an A2A-compliant HTTP server:

  - Configure `working_dir` and set `A2A_CODEX_BYPASS_APPROVALS=1` (inside an isolated container or sandbox) so Codex can execute tasks headlessly when triggered by a remote A2A client. [[1](https://github.com/hybroai/a2a-adapter/blob/main/examples/codex_agent.py)]

  

------

4. Antigravity CLI (`agy`) & Gemini CLI (`gemini`)

Because Antigravity CLI shares its core agent harness, skill loader, and MCP configuration architecture with Gemini CLI, both use the exact same integration pattern. [[1](https://antigravity.google/blog/introducing-google-antigravity-cli/), [2](https://daglo.ai/d/en/blog/gemini-cli-guide-gemini-md-mcp-antigravity-daglo)]

- **Outbound Setup (Client):**

  - **Option A (MCP Config):** Add `a2anet-mcp` to `~/.gemini/antigravity/mcp_config.json` (for `agy`) or `~/.gemini/settings.json` (for `gemini`). Both agents will immediately gain `get_agents`, `send_message`, and `get_task` tools.
  - **Option B (Native Skill):** Run `a2a skill` from the [A2A CLI](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c) and save the output to `~/.gemini/antigravity-cli/skills/a2a/SKILL.md` (or `~/.gemini/skills/a2a/SKILL.md`). [[1](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c), [2](https://github.com/a2anet/a2a-mcp), [3](https://github.com/akillness/jeo-skills)]

  

- **Inbound Setup (Server):** Neither `agy` nor `gemini` ships a built-in HTTP A2A server flag yet. Instead, wrap their headless execution mode using the official **`a2a server --exec`** wrapper from `a2a-cli`:

  bash

  ```
  a2a server --port 8090 --name "Antigravity Worker" \
    --exec "agy -p"
  ```

  Use code with caution.

  - When an external orchestrator sends an A2A `SendMessage` request to port `8090`, `a2a server` spawns `agy -p "<incoming prompt>"` (or `gemini -p "<incoming prompt>"`) in the target workspace, captures the stdout/artifacts, and returns a valid A2A v1.0 task response. *(Note: `a2a server --exec` also works as a zero-code fallback wrapper for Codex (`codex exec`) or Claude Code (`claude -p`) if you want a single uniform server wrapper across every CLI.)* [[1](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c)]

  

------

Summary Architecture: How They Talk Together

If you want all four agents collaborating in a single mesh on your machine or tailnet:

1. **Assign unique ports** for each inbound agent server (e.g., Pi on `:8081`, Claude Code on `:3008`, Codex on `:8082`, Antigravity on `:8090`).
2. **Expose each agent's `/.well-known/agent-card.json`** using its inbound wrapper (`@bacnh85/pi-a2a`, `claude-a2a`, `CodexAdapter`, or `a2a server --exec`).
3. **Register those URLs** in your orchestrator agent's `A2A_MCP_AGENT_CARDS` environment variable (via `a2anet-mcp`) or discover them dynamically via `a2a card get`. [[1](https://pi.dev/packages/@bacnh85/pi-a2a), [2](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c), [3](https://github.com/ericabouaf/claude-a2a), [4](https://github.com/hybroai/a2a-adapter/blob/main/examples/codex_agent.py), [5](https://github.com/a2anet/a2a-mcp)]

Would you like a ready-to-run **Docker Compose** or **systemd/tmux startup script** that launches all four coding agents as A2A servers on distinct local ports and wires them into a single orchestrator?

------
ExternalReference：
- [Testing and Serving A2A Agents from the Terminal with A2A CLI](https://medium.com/google-cloud/testing-and-serving-a2a-agents-from-the-terminal-with-a2a-cli-f2a24c26f68c)