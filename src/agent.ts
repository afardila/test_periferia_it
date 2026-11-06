import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { executeTool, toAnthropicTools, type AnyTool } from "./tools/registry.js";
import { createStore, type Store } from "./data.js";
import { tools } from "./tools/contratos.js"; // ← en el Reto 3: "./tools/oc.js"; en el Reto 1: "./tools/proveedor.js"

const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";
const MAX_TURNS = 12; // tope de iteraciones del bucle (evita ciclos y costos descontrolados)
const SYSTEM = fs.readFileSync(new URL("../agent/prompt.md", import.meta.url), "utf8");

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; output: unknown }
  | { type: "confirmation_required"; id: string; name: string; input: unknown }
  | { type: "error"; message: string };

interface Pending {
  blocks: Anthropic.ToolUseBlock[];
  idx: number;
  results: Anthropic.ToolResultBlockParam[];
}
interface Session {
  store: Store; // estado propio de la sesión: los casos no se contaminan entre sí
  messages: Anthropic.MessageParam[];
  pending?: Pending;
  usage: { input: number; output: number; cache_read: number; cache_write: number; calls: number };
}

const sessions = new Map<string, Session>();
const MAX_SESSIONS = 200; // tope para no crecer sin límite en un servicio público
function getSession(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    sessions.set(id, (s = { store: createStore(), messages: [], usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 } }));
  }
  return s;
}
export const storeOf = (id: string) => getSession(id).store;
export const resetSession = (id: string) => sessions.delete(id);
export const usageOf = (id: string) => getSession(id).usage;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic()); // lee ANTHROPIC_API_KEY del entorno

const toolByName = (n: string): AnyTool | undefined => tools.find((t) => t.name === n);
const asContent = (o: unknown) => (typeof o === "string" ? o : JSON.stringify(o));

/** Procesa los tool_use de un turno, en orden. Se detiene si hay una acción que requiere confirmación humana. */
async function processBlocks(s: Session, p: Pending, out: AgentEvent[]): Promise<"paused" | "done"> {
  for (; p.idx < p.blocks.length; p.idx++) {
    const b = p.blocks[p.idx];
    out.push({ type: "tool_call", id: b.id, name: b.name, input: b.input });
    if (toolByName(b.name)?.requiresConfirmation) {
      s.pending = p;
      out.push({ type: "confirmation_required", id: b.id, name: b.name, input: b.input });
      return "paused";
    }
    const r = await executeTool(tools, b.name, b.input, { store: s.store });
    out.push({ type: "tool_result", id: b.id, name: b.name, ok: r.ok, output: r.ok ? r.output : r.error });
    p.results.push({ type: "tool_result", tool_use_id: b.id, is_error: !r.ok, content: asContent(r.ok ? r.output : r.error) });
  }
  s.messages.push({ role: "user", content: p.results });
  s.pending = undefined;
  return "done";
}

/** Bucle del agente: modelo → herramientas → modelo… hasta que responde sin pedir herramientas. */
async function drive(s: Session, out: AgentEvent[]) {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: toAnthropicTools(tools),
      messages: s.messages,
    });
    s.usage.calls++;
    s.usage.input += resp.usage.input_tokens;
    s.usage.output += resp.usage.output_tokens;
    s.usage.cache_read += resp.usage.cache_read_input_tokens ?? 0;
    s.usage.cache_write += resp.usage.cache_creation_input_tokens ?? 0;
    s.messages.push({ role: "assistant", content: resp.content });

    for (const b of resp.content) if (b.type === "text" && b.text.trim()) out.push({ type: "text", text: b.text });
    const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length) return;
    const status = await processBlocks(s, { blocks: uses, idx: 0, results: [] }, out);
    if (status === "paused") return;
  }
  out.push({ type: "error", message: `Se alcanzó el máximo de ${MAX_TURNS} iteraciones.` });
}

export async function chat(sessionId: string, message: string): Promise<AgentEvent[]> {
  const s = getSession(sessionId);
  const out: AgentEvent[] = [];
  if (s.pending) return [{ type: "error", message: "Hay una acción pendiente de confirmación. Apruébala o recházala primero." }];
  s.messages.push({ role: "user", content: message });
  try { await drive(s, out); } catch (e) { out.push({ type: "error", message: (e as Error).message }); }
  return out;
}

/** El humano aprueba o rechaza la acción en pausa; luego el agente continúa. */
export async function confirm(sessionId: string, approve: boolean, note?: string): Promise<AgentEvent[]> {
  const s = getSession(sessionId);
  const p = s.pending;
  const out: AgentEvent[] = [];
  if (!p) return [{ type: "error", message: "No hay ninguna acción pendiente." }];
  const b = p.blocks[p.idx];
  try {
    if (approve) {
      const r = await executeTool(tools, b.name, b.input, { store: s.store });
      out.push({ type: "tool_result", id: b.id, name: b.name, ok: r.ok, output: r.ok ? r.output : r.error });
      p.results.push({ type: "tool_result", tool_use_id: b.id, is_error: !r.ok, content: asContent(r.ok ? r.output : r.error) });
    } else {
      const msg = `El humano RECHAZÓ esta acción${note ? `: ${note}` : ""}. No se ejecutó nada.`;
      out.push({ type: "tool_result", id: b.id, name: b.name, ok: false, output: msg });
      p.results.push({ type: "tool_result", tool_use_id: b.id, is_error: true, content: msg });
    }
    p.idx++;
    const status = await processBlocks(s, p, out);
    if (status === "done") await drive(s, out);
  } catch (e) {
    out.push({ type: "error", message: (e as Error).message });
  }
  return out;
}
