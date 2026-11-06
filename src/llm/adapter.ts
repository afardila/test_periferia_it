/** Interfaz propia del proveedor LLM. Cambiar de proveedor no toca el ciclo del agente (PRD 6.1). */
export type Bloque =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Mensaje {
  role: "system" | "user" | "assistant";
  content: string | Bloque[];
}

export interface HerramientaLLM {
  name: string;
  description: string;
  input_schema: { type: "object"; [k: string]: unknown };
}

export interface Uso { input: number; output: number; cache_read: number; cache_write: number }

export interface RespuestaLLM {
  texto: string;
  llamadas: { id: string; name: string; input: unknown }[];
  uso: Uso;
}

export interface LLM {
  proveedor: string;
  modelo: string;
  enviar(mensajes: Mensaje[], herramientas: HerramientaLLM[]): Promise<RespuestaLLM>;
}

/** Error del proveedor con mensaje apto para mostrar al usuario. */
export class ErrorLLM extends Error {}
