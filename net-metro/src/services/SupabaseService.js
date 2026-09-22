/**
 * NETMETRO - SERVICIO DE SUPABASE Y LEADERBOARD GLOBAL
 * El Leaderboard es exclusivamente en línea: sin conexión a Supabase no hay puntuaciones que
 * consultar ni forma de guardar una (no existe respaldo en LocalStorage ni datos de relleno).
 */

class SupabaseService {
  constructor() {
    this.client = null;
    this.isOnline = false;
    this.tableName = 'leaderboard';
    this.storageKey = 'netmetro_supabase_config';

    this.init();
  }

  async init() {
    // 1. Verificar si hay credenciales directas en src/config/supabaseConfig.js. Se carga con
    // import() DINÁMICO (no import estático) a propósito: ese archivo se genera en el build
    // (Vercel / GitHub Actions) o se copia a mano en local, así que puede no existir todavía.
    // Un import estático fallido rompe TODO el módulo (y a quien lo importe, o sea el juego
    // entero); uno dinámico solo rechaza esta promesa puntual, que sí podemos atrapar.
    let supabaseConfig = null;
    try {
      ({ SUPABASE_CONFIG: supabaseConfig } = await import('../config/supabaseConfig.js'));
    } catch (e) {
      console.warn('supabaseConfig.js no disponible: el juego sigue funcionando, pero el Leaderboard quedará sin conexión.', e);
    }

    if (supabaseConfig && supabaseConfig.url && supabaseConfig.anonKey && window.supabase) {
      try {
        this.client = window.supabase.createClient(supabaseConfig.url.trim(), supabaseConfig.anonKey.trim());
        this.isOnline = true;
        return;
      } catch (e) {
        console.warn('Error inicializando Supabase desde supabaseConfig.js:', e);
      }
    }

    // 2. Si no, intentar cargar configuración guardada en localStorage del navegador
    const savedConfig = localStorage.getItem(this.storageKey);
    if (savedConfig) {
      try {
        const { url, key } = JSON.parse(savedConfig);
        if (url && key && window.supabase) {
          this.client = window.supabase.createClient(url, key);
          this.isOnline = true;
        }
      } catch (e) {
        console.warn('Configuración de Supabase inválida en almacenamiento local:', e);
      }
    }
  }

  saveCredentials(url, key) {
    if (!url || !key) {
      throw new Error('Debes proporcionar la URL y la Anon Key de Supabase.');
    }

    if (!window.supabase) {
      throw new Error('Librería de Supabase no cargada.');
    }

    const cleanUrl = url.trim();
    const cleanKey = key.trim();

    this.client = window.supabase.createClient(cleanUrl, cleanKey);
    localStorage.setItem(this.storageKey, JSON.stringify({ url: cleanUrl, key: cleanKey }));
    this.isOnline = true;
  }

  async testConnection(url, key) {
    if (!window.supabase) {
      return { success: false, message: 'La librería de Supabase no se cargó correctamente.' };
    }

    try {
      const testClient = window.supabase.createClient(url.trim(), key.trim());
      // Hacer una consulta simple con limit 1
      const { data, error } = await testClient
        .from(this.tableName)
        .select('*')
        .limit(1);

      if (error) {
        if (error.code === '42P01') {
          return {
            success: false,
            message: 'Conexión exitosa, pero la tabla "leaderboard" aún no existe en Supabase. Ejecuta el script SQL.'
          };
        }
        return { success: false, message: `Error de Supabase: ${error.message}` };
      }

      return { success: true, message: '¡Conexión exitosa a la base de datos de Supabase!' };
    } catch (err) {
      return { success: false, message: `Fallo de conexión: ${err.message}` };
    }
  }

  // Guarda una puntuación EXCLUSIVAMENTE en Supabase. Sin conexión, no hay dónde guardarla:
  // se devuelve un fallo explícito en vez de simular éxito con un guardado local.
  async saveScore({ playerName, scorePackets, weeksSurvived, levelName }) {
    if (!this.client) {
      return { success: false, error: 'Sin conexión a la base de datos: no se pudo guardar el récord.' };
    }

    const record = {
      player_name: playerName || 'Ingeniero Anónimo',
      score_packets: parseInt(scorePackets, 10) || 0,
      weeks_survived: parseInt(weeksSurvived, 10) || 1,
      level_name: levelName || 'Campus LAN',
      created_at: new Date().toISOString()
    };

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .insert([record]);

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // Consulta el Top de puntuaciones EXCLUSIVAMENTE desde Supabase. Sin conexión (o si falla la
  // consulta), devuelve una lista vacía en vez de datos locales o de relleno.
  async getTopScores(limit = 10) {
    if (!this.client) {
      return { scores: [], source: 'offline' };
    }

    try {
      const { data, error } = await this.client
        .from(this.tableName)
        .select('*')
        .order('score_packets', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('Error obteniendo puntuaciones de Supabase:', error.message);
        return { scores: [], source: 'error' };
      }

      this.isOnline = true;
      return { scores: data || [], source: 'cloud' };
    } catch (e) {
      console.warn('Error obteniendo puntuaciones de Supabase:', e);
      return { scores: [], source: 'error' };
    }
  }
}

export const supabaseService = new SupabaseService();
