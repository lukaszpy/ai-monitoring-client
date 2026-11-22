# Local runtime adapters

This integration reads local files and optional local counters. It owns no HTTP API and requires no Postman workspace, remote mock, API key or agent prompt. Existing Codex stdio control is documented in [codex-protocol.md](codex-protocol.md).

## Read-only session preview

Monitoring adapters optionally expose `preview(nativeSessionId)` through the shared `SessionActivity` interface. `AgentMonitor` routes namespaced IDs to the owning source; IPC accepts only an ID selected from the current snapshot, never an arbitrary file path. Codex captures activity after the existing inherited-history boundary, Claude retains bounded activity by message/tool ID, and Gemini projects its replayed messages and tool results, including patches/removals/rewinds. Preview buffers never enter graph snapshots. A preview request does not read additional files, attach to a running terminal, call a model or modify logs.

The collector keeps at most 60 events and 64 KiB of text per buffer, truncating each entry to 3000 characters. Structured tool parameters are bounded; control sequences, image payloads and reasoning/thinking blocks are omitted. Text is rendered as text, never executable HTML. Buffer eviction and truncation are explicit in the UI. Deleted files disappear on the next normal scan; an open preview retries and marks its previous contents stale. Future adapters can omit the capability and return an unavailable preview while retaining ordinary monitoring.

The renderer opens one non-modal window per session over the graph. Windows have independent positions, sizes, focus order, follow toggles, polling cancellation on close, and bounded positions after resize. All eight edges/corners support pointer capture for resizing; the southeast handle also accepts arrow keys. Resizing holds the opposite edges fixed, enforces a 320×240 minimum where space allows, and stays inside the graph. The preferred size survives data updates and temporary viewport constraints, and resets when the preview is closed. Context-menu and keyboard entry points share the same read-only path. Switching between demo and live closes previews so demo IDs cannot request live data.

## Contracts

- `MonitoringAdapter.read()` returns provider-local sessions, source existence and diagnostics. No conversation bodies leave the adapter. File readers use bounded concurrency, incremental JSONL decoding, partial-line retention and reset on truncation/replacement. Symlinked entries are skipped. Gemini legacy JSON is read atomically per scan (64 MB bound).
- `ControlAdapter` is independent: live statuses, per-session capabilities and execution. The coordinator and renderer do not infer control from a transcript. Codex rechecks idle status before an operation; Claude and Gemini expose disabled actions.
- `AgentMonitor` qualifies IDs with runtime and source. A failed source does not hide others. Runtime registration is in `adapters/registry.ts`; new runtime identifiers and labels also belong in shared types and UI translations as needed. No external plugin loader is enabled.
- Source directories and optional context limits are explicitly configured, validated and persisted. Unknown context/limit remains null. Configured limits are estimates and do not override reported limits. File status is historical; unconfirmed running status expires after two minutes.

## Claude Code

Source: `projects/<project>/<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl`. Child IDs are scoped by the root transcript. Parent-agent relations come from Agent/Task `toolUseResult.agentId` mapped to the transcript that spawned them; message `parentUuid` is never used as agent lineage. If no proof of the immediate parent exists, lineage is unknown. Main-session title records are not inherited by children.

Assistant usage deduplicates by message ID (request ID fallback); prompt occupancy is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, excluding output. A `compact_boundary` invalidates the current measurement and retains lifetime usage. No model-name-to-window table is assumed.

Optional statusLine consumes the official `context_window` fields and writes versioned, whitelisted counter packets using atomic replacement. Null `current_usage` invalidates the measurement. Unchanged repeated packets preserve the measurement timestamp. The monitor ignores packets for the wrong runtime/source/session and packets older than transcript activity. The app copies configuration only; global Claude settings are never modified automatically. This mechanism is for sessions where the statusLine actually runs, not an assumed source for every subagent.

Official references: [statusLine fields](https://code.claude.com/docs/en/statusline), [hook session/transcript fields](https://code.claude.com/docs/en/hooks). Claude transcript internals are not a stable public API; fixtures reflect observed local records and must be reviewed when the tool changes.

## Gemini CLI

Source: `tmp/<project>/chats/session-*.jsonl` or legacy `.json`; child transcripts under `chats/<parent-session-id>/<child>.jsonl`. Explicit `parentSessionId` takes precedence; subagent kind without a parent is marked unknown. Provider IDs come from metadata, not shortened file names.

JSONL metadata `$set`, message records, `$patch` edits/tool results/removals/reordering, and inclusive `$rewindTo` are replayed. The current context comes from the latest surviving message with token usage. A separate deduplicated usage ledger keeps consumption when messages are removed or rewound. `tokens.input` includes cached prompt tokens; `tokens.total` is consumption, not context occupancy. No context limit is inferred from a model name. Unknown rewind target clears the replayed history, matching the upstream format.

Primary definitions: [chatRecordingTypes.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts), [chatRecordingService.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts). These upstream formats can change. Live validation on this workstation covers Codex and Claude only; Gemini uses deterministic fixtures until Gemini CLI is installed and exercised locally.

## Cost estimation

Adapters expose model-specific lifetime token buckets rather than provider monetary totals. Sources store explicit USD-per-million prices, with null for unknown rates and explicit zero for a zero rate. `src/shared/pricing-catalog.ts` applies optional offline Codex API Standard defaults, enabled for existing and new Codex sources, and passes rates to `src/shared/costs.ts`. An exact manual model entry replaces all default rates, including null and zero; aliases are never inferred. The dated snapshot cites its official model pages and currently covers `gpt-6.1-sol` and `gpt-6-sol`. Other models and runtimes require manual rates. `src/lib/costs.ts` aggregates the complete forest before view filters or collapse. Missing prices, unknown models, incomplete usage and uncertain lineage never become a complete zero-cost tree. The display switch is independent of local usage collection.

Codex uses cumulative counter deltas, with the last-request usage as a first visible baseline to exclude unseen/inherited usage; missing prefixes remain partial. Cache reads and writes are subsets of total input and are removed from uncached input before pricing; absent write counters in older logs default to zero. Output reasoning is already included in its output counter. Each request retains its pricing band (input >272K), even after model buckets are aggregated. Built-in rates apply the published long-context multipliers; manual entries retain flat user-supplied rates. Unknown bands are partial. Claude separates uncached input, cache reads, cache writes by TTL where known, and output, deduplicated by message ID. Gemini separates cached input from prompt input and adds `thoughts` to candidate output, retaining its lifetime ledger through rewind. Reported provider totals (including Claude statusLine cost) are deliberately not combined with child estimates because their inclusive scope is not established. This implementation does not ingest billing APIs or fetch price lists. Its API Standard equivalent excludes service tiers, regional premiums, discounts, subscriptions, tools and non-token fees.

Primary token definitions: [Claude cache usage](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Gemini recording service](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts). These describe token categories, not the configured price assumptions or a bill.
