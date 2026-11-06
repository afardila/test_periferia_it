import fs from "node:fs";
import path from "node:path";
import { crearAgente } from "./agent.js";
import { crearAnthropic } from "./llm/anthropic.js";
import { createApp } from "./server.js";

const root = path.resolve(import.meta.dirname, "..");
fs.rmSync(path.join(root, "out"), { recursive: true, force: true }); // out/ se limpia al inicio (determinismo)
const port = Number(process.env.PORT ?? 3000);
if (!process.env.APP_PASSWORD) console.warn("⚠️  APP_PASSWORD no está definida: la app queda abierta. En producción defínela.");
if (!process.env.ANTHROPIC_API_KEY) console.warn("⚠️  Falta ANTHROPIC_API_KEY: el chat responderá con error hasta configurarla.");
const agente = crearAgente({ llm: crearAnthropic() });
createApp({ agente }).listen(port, () => console.log(`Agente listo en http://localhost:${port} (${agente.llm.proveedor}/${agente.llm.modelo})`));
