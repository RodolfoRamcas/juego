/**
 * NETMETRO - GENERADOR DE supabaseConfig.js A PARTIR DE VARIABLES DE ENTORNO
 *
 * Lo ejecuta el paso de build de Vercel y el workflow de GitHub Actions, ambos usando las
 * variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY configuradas en su respectivo
 * panel (Vercel: Project Settings -> Environment Variables; GitHub: Settings -> Secrets and
 * variables -> Actions). El resultado nunca se commitea: solo existe en el build/deploy.
 *
 * No requiere dependencias (usa únicamente el runtime de Node).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = join(scriptDir, '..', 'src', 'config', 'supabaseConfig.js');

const url = process.env.SUPABASE_URL || '';
const anonKey = process.env.SUPABASE_ANON_KEY || '';

if (!url || !anonKey) {
  console.warn('[generate-supabase-config] SUPABASE_URL o SUPABASE_ANON_KEY no están definidas: el juego arrancará sin Leaderboard en la nube (modo local).');
}

const content = `/**
 * Generado automáticamente en el build a partir de variables de entorno
 * (SUPABASE_URL / SUPABASE_ANON_KEY). NO editar a mano ni commitear con valores reales:
 * ver supabaseConfig.example.js para desarrollo local.
 */
export const SUPABASE_CONFIG = {
  url: '${url}',
  anonKey: '${anonKey}'
};
`;

writeFileSync(outPath, content, 'utf8');
console.log(`[generate-supabase-config] supabaseConfig.js generado (url ${url ? 'definida' : 'VACÍA'}, anonKey ${anonKey ? 'definida' : 'VACÍA'}).`);
