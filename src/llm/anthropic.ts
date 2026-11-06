import Anthropic from "@anthropic-ai/sdk";
import { ErrorLLM, type LLM, type Mensaje, type RespuestaLLM, type HerramientaLLM, type Bloque } from "./adapter.js";

const aBloqueAnthropic = (b: Bloque): Anthropic.ContentBlockParam =>
  b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: b.input }
  : b.type === "tool_result" ? { type: "tool_result", tool_use_id: b.tool_use_id, content: b.content, is_error: b.is_error }
  : { type: "text", text: b.text };

/** Implementación para Anthropic. La clave se lee SOLO de ANTHROPIC_API_KEY (entorno del backend). */
export function crearAnthropic(modelo = process.env.MODEL ?? "claude-sonnet-5-5"): LLM {
  let client: Anthropic | null = null;
  const timeout = Number(process.env.LLM_TIMEOUT_MS ?? 60_000);
  return {
    proveedor: "anthropic",
    modelo,
    async enviar(mensajes: Mensaje[], herramientas: HerramientaLLM[]): Promise<RespuestaLLM> {
      client ??= new Anthropic({ timeout, maxRetries: 1 });
      const sistema = mensajes.filter((m) => m.role === "system").map((m) => (typeof m.content === "string" ? m.content : "")).join("\n\n");
      const conversacion: Anthropic.MessageParam[] = mensajes
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : m.content.map(aBloqueAnthropic),
        }));
      try {
        const r = await client.messages.create({
          model: modelo,
          max_tokens: 4096,
          system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
          tools: herramientas,
          messages: conversacion,
        });
        return {
          texto: r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim(),
          llamadas: r.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input })),
          uso: {
            input: r.usage.input_tokens,
            output: r.usage.output_tokens,
            cache_read: r.usage.cache_read_input_tokens ?? 0,
            cache_write: r.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (e) {
        const msg = (e as Error).message ?? "";
        if (/timeout|timed out/i.test(msg)) throw new ErrorLLM("El modelo tardó demasiado en responder (timeout). Intenta de nuevo.");
        if (/401|authentication|api[_ ]key/i.test(msg)) throw new ErrorLLM("El servidor no pudo autenticarse con el proveedor del modelo.");
        if (/429|rate/i.test(msg)) throw new ErrorLLM("El proveedor del modelo está limitando las solicitudes. Intenta en un minuto.");
        throw new ErrorLLM("Falló la llamada al modelo. Intenta de nuevo.");
      }
    },
  };
}
