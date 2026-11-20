#!/usr/bin/env node
/* Herramienta de formato de contenido.
     node scripts/formato.mjs convertir <test.json> [salida.json]   formato 1 → formato 2 (sin salida, la escribe por pantalla)
     node scripts/formato.mjs validar <test.json>                    convierte si hace falta y lista los problemas
     node scripts/formato.mjs comprobar <test.json>                  comprueba que convertir y volver no pierde nada
   No toca nada por sí sola: solo lee el archivo y, si das salida, escribe ESE archivo. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { aFormato2, aFormato1, validarBanco } from '../js/nucleo/formato.js';

const [orden, entrada, salida] = process.argv.slice(2);
if (!['convertir', 'validar', 'comprobar'].includes(orden) || !entrada) {
  console.error('Uso: node scripts/formato.mjs convertir|validar|comprobar <test.json> [salida.json]'); process.exit(2);
}
const original = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const f2 = aFormato2(original);

if (orden === 'convertir') {
  const texto = JSON.stringify(f2, null, 2) + '\n';
  if (salida) { fs.writeFileSync(salida, texto); console.log('Escrito ' + salida + ' (' + f2.preguntas.length + ' preguntas, formato 2)'); }
  else process.stdout.write(texto);
} else if (orden === 'validar') {
  const p = validarBanco(f2);
  if (p.length) { console.error(p.length + ' problema(s) en ' + entrada + ':\n- ' + p.join('\n- ')); process.exit(1); }
  console.log(entrada + ': OK (' + f2.preguntas.length + ' preguntas, formato 2)');
} else {
  if (original.formato === 2) { console.log(entrada + ' ya está en formato 2: nada que comprobar'); process.exit(0); }
  try { assert.deepEqual(aFormato1(f2), original); console.log(entrada + ': convertir y volver no pierde nada'); }
  catch (e) { console.error(entrada + ': SE PIERDE ALGO al convertir\n' + e.message); process.exit(1); }
}
