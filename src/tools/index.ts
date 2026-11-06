/** Registro de herramientas: cada export de contratos.ts → herramienta `contratos_<export>`. */
import * as contratos from "./contratos.js";
import { nombrar } from "./registry.js";

export const tools = nombrar("contratos", { ...contratos });
