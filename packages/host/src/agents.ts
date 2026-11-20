/*
 * Tools for agents (ADR 0018): which topics the app exposes, checked and
 * turned into tool descriptions once, at `createKernel`. Transports (the dev
 * MCP, `@isoloop/webmcp`) list them through `kernel.tools()` and call them
 * through `kernel.request`.
 */
import {
  isRequestVia,
  matchAny,
  topicJsonSchemas,
  type ContractsList,
  type RequestVia,
  type TopicRef,
  type TopicShape,
} from '@isoloop/protocol';

/**
 * `KernelConfig.agents` (ADR 0018, decision 2): the topics agents may call.
 * @experimental
 */
export type AgentsConfig = {
  /**
   * Grant patterns (`*` matches one or more characters, dots included) naming the topics
   * agents may call, for example `['markets.quote.v1', 'markets.alerts.*']`.
   * Each topic matched needs a `reply`, a `tool`, and schemas that make JSON
   * Schema (Standard JSON Schema; not `unchecked()`), or `createKernel`
   * throws `not_exposable`. A pattern that matches nothing is reported once
   * through the `agents:unmatched` event.
   */
  readonly expose: readonly string[];
  /** How long transports wait for a tool's reply, in ms. Default 10 s (ADR 0018, decision 5). */
  readonly timeoutMs?: number;
};

/** `agents.timeoutMs` when not set (ADR 0018, decision 5). */
export const DEFAULT_AGENT_TIMEOUT_MS = 10_000;

/** A JSON Schema document, draft 2020-12. */
export type ToolJsonSchema = { readonly [key: string]: unknown };

/**
 * An exposed tool, as `kernel.tools()` lists it (ADR 0018, decision 2).
 * Everything but `topic` is plain data a transport can send as is.
 * @experimental
 */
export type AgentTool = {
  /** The topic's name, which is the tool's name (`markets.quote.v1`). */
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** WebMCP and MCP `readOnlyHint`. */
  readonly readOnly: boolean;
  /** WebMCP `consequentialHint`, MCP `destructiveHint`. */
  readonly consequential: boolean;
  /** WebMCP `untrustedContentHint`: the reply can carry third-party text. */
  readonly untrustedContent: boolean;
  /** The topic schema's input, as JSON Schema draft 2020-12. */
  readonly inputSchema: ToolJsonSchema;
  /** The `reply` schema's output, as JSON Schema draft 2020-12. */
  readonly outputSchema: ToolJsonSchema;
  /** `agents.timeoutMs`, for transports to pass to `kernel.request`. */
  readonly timeoutMs: number;
  /** The topic, for `kernel.request(tool.topic, input, …)`. */
  readonly topic: TopicRef<unknown, unknown, unknown, unknown>;
};

/** `kernel.request`'s options (ADR 0018, decision 4). @experimental */
export type RequestOptions = {
  key?: string;
  /** Default 30 s, the bus's. Transports pass `agents.timeoutMs` (`AgentTool.timeoutMs`). */
  timeoutMs?: number;
  /** Aborting rejects the call with `BusError('aborted')`. */
  signal?: AbortSignal;
  /**
   * The transport making the call, set on the record as `req.via`. A label
   * for logging and policy between cooperating code on one page; never
   * authorize anything by it.
   */
  via?: RequestVia;
};

/** `agents` problems that make `createKernel` throw `invalid_config`, or `undefined`. */
export function agentsConfigProblem(a: AgentsConfig): string | undefined {
  if (!Array.isArray(a.expose) || !a.expose.every((p) => typeof p === 'string' && p !== ''))
    return '`agents.expose` must be an array of non-empty topic patterns';
  const t = a.timeoutMs;
  if (t !== undefined && !(typeof t === 'number' && Number.isFinite(t) && t > 0))
    return '`agents.timeoutMs` must be a positive number of milliseconds';
  return undefined;
}

/** `request`'s options problems, or `undefined`. */
export function requestOptionsProblem(o: RequestOptions): string | undefined {
  const t = o.timeoutMs;
  if (t !== undefined && !(typeof t === 'number' && Number.isFinite(t) && t > 0))
    return 'timeoutMs must be a positive number of milliseconds';
  if (o.key !== undefined && typeof o.key !== 'string') return 'key must be a string';
  if (o.via !== undefined && !isRequestVia(o.via)) return 'via must be mcp, webmcp or builder';
  return undefined;
}

export type ToolsResult =
  | { readonly ok: true; readonly tools: readonly AgentTool[]; readonly unmatched: string[] }
  /** `message` names the topic: what `not_exposable` says. */
  | { readonly ok: false; readonly topic: string; readonly message: string };

const isToolSpec = (t: TopicShape['tool']): boolean =>
  typeof t === 'object' &&
  t !== null &&
  typeof t.description === 'string' &&
  t.description !== '' &&
  typeof t.readOnly === 'boolean';

/**
 * The exposed tools (ADR 0018, decisions 2–3): every contracts topic an
 * `expose` pattern matches, with its JSON Schemas, or the first topic that
 * can't be a tool. Topics are listed in contracts order.
 */
export function buildTools(list: ContractsList | undefined, agents: AgentsConfig): ToolsResult {
  const topics = list?.topics ?? [];
  const timeoutMs = agents.timeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  const unmatched = agents.expose.filter((p) => !topics.some((t) => matchAny([p], t.name)));
  const tools: AgentTool[] = [];
  for (const t of topics) {
    if (!matchAny(agents.expose, t.name)) continue;
    const fail = (why: string) =>
      ({ ok: false, topic: t.name, message: `${t.name}: ${why}` }) as const;
    if (t.reply === undefined) return fail("has no reply schema, so it can't be requested");
    if (t.tool === undefined) return fail('has no `tool` description');
    if (!isToolSpec(t.tool))
      return fail('its `tool` needs a non-empty `description` and a boolean `readOnly`');
    const schemas = topicJsonSchemas({ name: t.name, schema: t.schema, reply: t.reply });
    if (!schemas.ok) return { ok: false, topic: t.name, message: schemas.message };
    const reply = schemas.reply;
    if (!reply) return fail("has no reply schema, so it can't be requested");
    const { title, description, readOnly, consequential, untrustedContent } = t.tool;
    tools.push(
      Object.freeze({
        name: t.name,
        ...(title === undefined ? {} : { title }),
        description,
        readOnly,
        consequential: consequential ?? false,
        untrustedContent: untrustedContent ?? false,
        inputSchema: schemas.schema.input,
        outputSchema: reply.output,
        timeoutMs,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a contracts topic is a TopicRef at run time (it has `schema`); the host never reads its types
        topic: t as unknown as TopicRef<unknown, unknown, unknown, unknown>,
      }),
    );
  }
  return { ok: true, tools: Object.freeze(tools), unmatched };
}
