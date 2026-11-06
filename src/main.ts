import { createApp } from "./server.js";

const port = Number(process.env.PORT ?? 3000);
if (!process.env.APP_PASSWORD) console.warn("⚠️  APP_PASSWORD no está definida: la app queda abierta. En producción defínela.");
createApp().listen(port, () => console.log(`Agente listo en http://localhost:${port}`));
