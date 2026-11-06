import { z } from "zod";
import type { Store } from "../data.js";

/** Contexto por sesión: cada conversación opera sobre su PROPIO estado (no se cruzan casos). */
export interface ToolCtx { store: Store }

/**
 * Definición de una herramienta del agente.
 * - schema: contrato de entrada (zod). Se valida SIEMPRE antes de ejecutar.
 * - requiresConfirmation: acciones que modifican estado → el humano debe aprobar.
 */
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  requiresConfirmation?: boolean;
  run: (input: z.output<S>, ctx: ToolCtx) => unknown | Promise<unknown>;
}

export function defineTool<S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> {
  return t;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolDef<any>;

/** Convierte las tools al formato que espera la API de Anthropic. */
export function toAnthropicTools(tools: AnyTool[]) {
  return tools.map((t) => {
    const js = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    delete js.$schema;
    return {
      name: t.name,
      description: t.description,
      input_schema: js as { type: "object"; [k: string]: unknown },
    };
  });
}

export type ToolOutcome = { ok: true; output: unknown } | { ok: false; error: string };

/** Valida la entrada con zod y ejecuta. Nunca lanza: devuelve el error al modelo para que se corrija. */
export async function executeTool(tools: AnyTool[], name: string, rawInput: unknown, ctx: ToolCtx): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Herramienta desconocida: ${name}` };
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: `Entrada inválida: ${z.prettifyError(parsed.error)}` };
  }
  try {
    return { ok: true, output: await tool.run(parsed.data, ctx) };
  } catch (e) {
    return { ok: false, error: `Fallo al ejecutar ${name}: ${(e as Error).message}` };
  }
}
