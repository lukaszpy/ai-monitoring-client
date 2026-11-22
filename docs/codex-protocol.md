# Local Codex integration contract

Verified against locally generated protocol types from Codex CLI 0.170.0. Upstream reference: <https://learn.chatgpt.com/docs/app-server>.

Transport: spawn the native executable directly as `codex app-server proxy`, with the selected `CODEX_HOME`. Newline-delimited JSON-RPC requests and notifications over stdin/stdout. There is no HTTP endpoint or cloud API owned by AI Monitoring. No Postman workspace or remote mock is necessary for this local stdio consumer; its deterministic fixture is `tests/fixtures/codex-proxy.mjs`.

| Method | When | Required contract |
| --- | --- | --- |
| `initialize` | On connection | `clientInfo.name`, `clientInfo.version`, `capabilities: {}` |
| `initialized` | After successful initialize | Notification, no request ID |
| `thread/loaded/list` | Background polling | Follow `nextCursor`; `data` contains thread IDs |
| `thread/read` | For loaded threads and before each action | `threadId`, `includeTurns: false`; inspect `thread.status` |
| `thread/compact/start` | Only user-confirmed action, idle thread | `threadId`; immediate acknowledgment does not mean compaction completed |
| `thread/start` | Only user-confirmed fresh root | `cwd`, `model`, `modelProvider`, `serviceName`; expect `thread.id` |

Background monitoring is restricted to handshake and reads. It does not call `thread/resume`, `turn/start`, `turn/interrupt`, `thread/delete`, filesystem write methods, approvals, or tools. Incoming server requests are rejected rather than approved on the user's behalf.

Runtime status mapping: `active` → running, `active` with `waitingOnApproval` / `waitingOnUserInput` → waiting, `idle` → ready, `systemError` → error. Unrecognized status is unknown. Merely being loaded is not proof of running.

Each request has an 8-second timeout; disconnect rejects pending requests and clears runtime state. Reconnect waits 30 seconds. Missing executable, unsupported proxy, stale socket, and unavailable daemon all degrade to file monitoring. Tests cover successful handshake, paginated listing, background read-only behavior, idle guards, unloaded threads, root creation, child reset rejection, and missing executable. Live compaction and fresh context are intentionally not executed by tests.
