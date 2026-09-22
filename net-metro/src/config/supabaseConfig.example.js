/**
 * NETMETRO - PLANTILLA DE CONFIGURACIÓN DE SUPABASE
 *
 * Este archivo SÍ se sube al repositorio (es solo una plantilla, sin claves reales).
 * Para desarrollo local:
 *   1. Copia este archivo como `supabaseConfig.js` en esta misma carpeta
 *      (ese nombre ya está en .gitignore, así que nunca se subirá con tus claves reales).
 *   2. Completa `url` y `anonKey` con los valores de tu proyecto en
 *      Supabase Dashboard -> Project Settings -> API Keys.
 *
 * IMPORTANTE: usa siempre la clave "anon" / "publishable" (empieza con `sb_publishable_`,
 * o el JWT legado que Supabase llama "anon public"). NUNCA la clave "secret" / "service_role"
 * (empieza con `sb_secret_`): esa tiene acceso total a la base de datos sin respetar Row Level
 * Security, y no debe usarse nunca en código que corra en el navegador.
 *
 * Para producción (GitHub Pages), no edites este archivo ni el `supabaseConfig.js` local:
 * el workflow de GitHub Actions (.github/workflows/deploy.yml) genera la versión real a
 * partir de los Secrets del repositorio (SUPABASE_URL y SUPABASE_ANON_KEY) al momento de
 * publicar, así que la clave nunca queda guardada en el código fuente.
 */

export const SUPABASE_CONFIG = {
  url: '',
  anonKey: ''
};
