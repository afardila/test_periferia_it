/** Ciclo del agente: modelo → herramientas → modelo… con tope de iteraciones y de tokens, y confirmación humana. */
import fs from "node:fs";
import path from "node:path";
import { tools } from "./tools/contratos.js";
import { ejecutar, paraLLM, type ToolCtx } from "./tools/registry.js";
import { borrarSalida, leerProcesados, leerTextoOut, maestroSinCrear, type Fila, type Procesados } from "./tools/maestro.js";
import { ErrorLLM, type Bloque, type LLM, type Mensaje, type Uso } from "./llm/adapter.js";

export type Evento =
  | { type: "user"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown; ok: boolean; output: unknown }
  | { type: "error"; message: string };
export type EventoHerramienta = Extract<Evento, { type: "tool" }>;

export interface ChatResult {
  status: number;
  reply: string;
  toolCalls: EventoHerramienta[];
  needsConfirmation: boolean;
  events: Evento[];
  usage: Uso & { calls: number };
}
interface Sesion {
  mensajes: Mensaje[];
  eventos: Evento[];
  usage: Uso & { calls: number };
  turnosUsuario: number;
  bloqueados: Map<string, number>; // mensaje_id → turno de usuario en que se pidió revisión
}

const ROOT = path.resolve(import.meta.dirname, "..");
const leer = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Comportamiento (agent/prompt.md) + conocimiento del proceso (src/knowledge/). La ejecución vive en src/tools/. */
export const cargarSistema = () => `${leer("agent/prompt.md")}\n\n# Conocimiento del proceso\n\n${leer("src/knowledge/registro-contratos.md")}`;

export interface OpcionesAgente { llm: LLM; directory?: string; maxIter?: number; maxTokens?: number; maxSesiones?: number }

export function crearAgente(opts: OpcionesAgente) {
  const { llm } = opts;
  const directory = opts.directory ?? ROOT;
  const maxIter = opts.maxIter ?? Number(process.env.MAX_ITER ?? 25);
  const maxTokens = opts.maxTokens ?? Number(process.env.MAX_SESSION_TOKENS ?? 300_000);
  const maxSesiones = opts.maxSesiones ?? 200;
  const sistema = cargarSistema();
  const sesiones = new Map<string, Sesion>();
  const ctxDe = (id: string): ToolCtx => ({ directory, sessionId: id });
  const gastados = (s: Sesion) => s.usage.input + s.usage.output + s.usage.cache_write;
  const resumir = (o: string) => (o.length > 4000 ? o.slice(0, 4000) + "…" : o);

  function obtener(id: string): Sesion {
    let s = sesiones.get(id);
    if (!s) {
      if (sesiones.size >= maxSesiones) { const viejo = sesiones.keys().next().value!; sesiones.delete(viejo); borrarSalida(ctxDe(viejo)); }
      sesiones.set(id, (s = { mensajes: [{ role: "system", content: sistema }], eventos: [], usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 }, turnosUsuario: 0, bloqueados: new Map() }));
    }
    return s;
  }

  async function chat(id: string, message: string): Promise<ChatResult> {
    const s = obtener(id);
    const toolCalls: EventoHerramienta[] = []; const nuevos: Evento[] = [];
    let needsConfirmation = false; let reply = ""; let status = 200;
    const resultado = (): ChatResult => ({ status, reply, toolCalls, needsConfirmation, events: nuevos, usage: { ...s.usage } });
    const emitir = (e: Evento) => { s.eventos.push(e); nuevos.push(e); };

    if (gastados(s) >= maxTokens) {
      status = 429; reply = `Esta sesión alcanzó el tope de tokens (${maxTokens}). Inicia una nueva sesión para continuar.`;
      nuevos.push({ type: "error", message: reply }); return resultado();
    }
    const base = s.mensajes.length;
    s.turnosUsuario++; s.mensajes.push({ role: "user", content: message }); emitir({ type: "user", text: message });
    const ctx: ToolCtx = { ...ctxDe(id), puedeConfirmar: (mid) => (s.bloqueados.get(mid) ?? Infinity) < s.turnosUsuario };

    try {
      let terminado = false;
      for (let it = 0; it < maxIter && !terminado; it++) {
        if (gastados(s) >= maxTokens) { reply = `Se alcanzó el tope de tokens de la sesión (${maxTokens}). Lo avanzado quedó registrado; inicia una sesión nueva para continuar.`; terminado = true; break; }
        const r = await llm.enviar(s.mensajes, paraLLM(tools));
        s.usage.calls++; s.usage.input += r.uso.input; s.usage.output += r.uso.output; s.usage.cache_read += r.uso.cache_read; s.usage.cache_write += r.uso.cache_write;
        const bloques: Bloque[] = [...(r.texto ? [{ type: "text" as const, text: r.texto }] : []), ...r.llamadas.map((l) => ({ type: "tool_use" as const, id: l.id, name: l.name, input: l.input }))];
        s.mensajes.push({ role: "assistant", content: bloques });
        if (r.texto) emitir({ type: "text", text: r.texto });
        if (!r.llamadas.length) { reply = r.texto; terminado = true; break; }
        const resultados: Bloque[] = [];
        for (const l of r.llamadas) {
          const salida = await ejecutar(tools, l.name, l.input, ctx);
          let ok = false; let error = "";
          try { const p = JSON.parse(salida) as { ok: boolean; error?: string }; ok = p.ok; error = p.error ?? ""; } catch { /* salida no JSON */ }
          const mid = (l.input as { mensaje_id?: unknown } | null)?.mensaje_id;
          if (l.name === "contratos_registrar" && !ok && error.startsWith("requiere revisión") && typeof mid === "string") { s.bloqueados.set(mid, s.turnosUsuario); needsConfirmation = true; }
          const ev: EventoHerramienta = { type: "tool", id: l.id, name: l.name, input: l.input, ok, output: ok ? resumir(salida) : error || resumir(salida) };
          toolCalls.push(ev); emitir(ev);
          resultados.push({ type: "tool_result", tool_use_id: l.id, content: salida, is_error: !ok });
        }
        s.mensajes.push({ role: "user", content: resultados });
      }
      if (!terminado) {
        const hechas = toolCalls.map((t) => `${t.name}${(t.input as { mensaje_id?: string })?.mensaje_id ? `(${(t.input as { mensaje_id: string }).mensaje_id})` : ""} ${t.ok ? "✓" : "✗"}`).join(", ");
        reply = `Alcancé el tope de ${maxIter} iteraciones en este turno. Lo hecho: ${hechas || "nada"}. Escribe "continúa" para seguir con lo que falta.`;
        emitir({ type: "text", text: reply });
      } else if (reply === "" || (needsConfirmation && !toolCalls.length)) {
        /* respuesta vacía del modelo: se deja tal cual */
      }
    } catch (e) {
      s.mensajes.length = base; // la sesión sigue viva: se descarta solo el turno fallido
      reply = e instanceof ErrorLLM ? e.message : "Ocurrió un error inesperado al procesar tu mensaje.";
      emitir({ type: "error", message: reply });
    }
    return resultado();
  }

  return {
    llm, chat, maxTokens, maxIter,
    existe: (id: string) => sesiones.has(id),
    historial: (id: string) => (sesiones.has(id) ? { eventos: sesiones.get(id)!.eventos, usage: { ...sesiones.get(id)!.usage } } : null),
    estado(id: string): { maestro: Fila[]; procesados: Procesados; alertas_md: string | null } {
      const c = ctxDe(id); return { maestro: maestroSinCrear(c), procesados: sesiones.has(id) ? leerProcesados(c) : {}, alertas_md: sesiones.has(id) ? leerTextoOut(c, "alertas.md") : null };
    },
    reset(id: string) { sesiones.delete(id); borrarSalida(ctxDe(id)); },
  };
}
export type Agente = ReturnType<typeof crearAgente>;
