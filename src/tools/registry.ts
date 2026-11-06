import { z } from "zod";
import type { HerramientaLLM } from "../llm/adapter.js";

/** Contexto que recibe cada herramienta. directory = raíz del proyecto (nunca rutas absolutas desde el modelo). */
export interface ToolCtx {
  directory: string;
  sessionId: string;
  /** Guardia opcional del ciclo del agente: ¿ya hubo respuesta humana para confirmar este mensaje? */
  puedeConfirmar?: (mensajeId: string) => boolean;
}

/** Contrato de herramienta (PRD 6.2): description + args (zod) + execute → string JSON. Nunca lanza. */
export interface ToolDef {
  description: string;
  args: z.ZodRawShape;
  execute: (rawArgs: unknown, ctx: ToolCtx) => Promise<string>;
}
export interface NamedTool extends ToolDef { name: string }

export const ok = (data: unknown): string => JSON.stringify({ ok: true, data });
export const fail = (error: string): string => JSON.stringify({ ok: false, error });

/**
 * Define una herramienta: valida con zod ANTES de ejecutar y convierte cualquier excepción en { ok:false, error }.
 */
export function defineTool<A extends z.ZodRawShape>(def: {
  description: string;
  args: A;
  execute: (args: z.infer<z.ZodObject<A>>, ctx: ToolCtx) => string | Promise<string>;
}): ToolDef {
  const schema = z.object(def.args);
  return {
    description: def.description,
    args: def.args,
    async execute(raw, ctx) {
      try {
        const parsed = schema.safeParse(raw ?? {});
        if (!parsed.success) return fail(`Argumentos inválidos: ${z.prettifyError(parsed.error)}`);
        return await def.execute(parsed.data, ctx);
      }
      catch (e) { return fail(`Fallo interno: ${(e as Error).message}`); }
    },
  };
}

/** El nombre que ve el modelo es <archivo>_<export>. */
export function nombrar(prefijo: string, defs: Record<string, ToolDef>): NamedTool[] {
  return Object.entries(defs).map(([k, d]) => ({ name: `${prefijo}_${k}`, ...d }));
}

export function paraLLM(tools: NamedTool[]): HerramientaLLM[] {
  return tools.map((t) => {
    const js = z.toJSONSchema(z.object(t.args), { io: "input" }) as Record<string, unknown>;
    delete js.$schema;
    return { name: t.name, description: t.description, input_schema: js as HerramientaLLM["input_schema"] };
  });
}

/** Ejecuta por nombre. Devuelve SIEMPRE el string JSON de la herramienta. */
export async function ejecutar(tools: NamedTool[], name: string, raw: unknown, ctx: ToolCtx): Promise<string> {
  const t = tools.find((x) => x.name === name);
  if (!t) return fail(`Herramienta desconocida: ${name}`);
  return t.execute(raw, ctx);
}

export interface Resultado { ok: boolean; data?: unknown; error?: string }
/** Igual que ejecutar pero ya parseado (para demo y pruebas). */
export async function llamar(tools: NamedTool[], name: string, raw: unknown, ctx: ToolCtx): Promise<Resultado> {
  return JSON.parse(await ejecutar(tools, name, raw, ctx)) as Resultado;
}
