/** Bonus: el módulo reutilizable usa las mismas piezas que la app (sin copias divergentes). AC-53 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { generarModulo } from "../scripts/build-modulo.js";
import * as modulo from "../modulo/tools/contratos.js";
import * as app from "../src/tools/contratos.js";
import { tools } from "../src/tools/index.js";

const ROOT = path.resolve(import.meta.dirname, "..");

test("AC-53 [+] agent.md y SKILL.md del módulo están sincronizados con prompt.md y knowledge", () => {
  for (const [rel, esperado] of Object.entries(generarModulo())) assert.equal(fs.readFileSync(path.join(ROOT, rel), "utf8"), esperado, `${rel} desincronizado: ejecuta npm run build:modulo`);
});
test("AC-53 [+] las herramientas del módulo son las mismas de la app y cada export cumple el contrato", () => {
  assert.deepEqual(Object.keys(modulo).sort(), Object.keys(app).sort());
  for (const [k, t] of Object.entries(modulo)) {
    assert.strictEqual(t, (app as Record<string, unknown>)[k], k);
    assert.equal(typeof t.description, "string"); assert.equal(typeof t.args, "object"); assert.equal(typeof t.execute, "function");
  }
  assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(modulo).map((k) => `contratos_${k}`).sort());
});
test("AC-53 [+] agent.md declara mode primary y permisos edit/bash en deny", () => {
  const md = fs.readFileSync(path.join(ROOT, "modulo/agent.md"), "utf8");
  assert.match(md, /^---\n[\s\S]*mode: primary[\s\S]*edit: deny[\s\S]*bash: deny[\s\S]*---/);
});
