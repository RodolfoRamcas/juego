/**
 * NETMETRO - SERVICIO DE SUPABASE Y LEADERBOARD GLOBAL
 * Soporta conexión en tiempo real con Supabase y modo offline con LocalStorage.
 */

import { SUPABASE_CONFIG } from '../config/supabaseConfig.js';

class SupabaseService {
  constructor() {
    this.client = null;
    this.isOnline = false;
    this.tableName = 'leaderboard';
    this.storageKey = 'netmetro_supabase_config';
    this.localLeaderboardKey = 'netmetro_local_scores';

    this.init();
  }

  init() {
    // 1. Verificar si hay credenciales directas en src/config/supabaseConfig.js
    if (SUPABASE_CONFIG && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && window.supabase) {
      try {
        this.client = window.supabase.createClient(SUPABASE_CONFIG.url.trim(), SUPABASE_CONFIG.anonKey.trim());
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

    // Inicializar scores locales por defecto si no existen
    if (!localStorage.getItem(this.localLeaderboardKey)) {
      this.initDefaultLocalScores();
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

  async saveScore({ playerName, scorePackets, weeksSurvived, levelName }) {
    const record = {
      player_name: playerName || 'Ingeniero Anónimo',
      score_packets: parseInt(scorePackets, 10) || 0,
      weeks_survived: parseInt(weeksSurvived, 10) || 1,
      level_name: levelName || 'Campus LAN',
      created_at: new Date().toISOString()
    };

    // Guardar siempre en caché local
    this.saveToLocalStorage(record);

    // Si Supabase está conectado, guardar en la nube
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from(this.tableName)
          .insert([record]);

        if (error) {
          console.warn('Error al guardar en Supabase (guardado en local):', error.message);
          return { success: true, mode: 'local', error: error.message };
        }
        return { success: true, mode: 'cloud', data };
      } catch (err) {
        console.warn('Fallo de red con Supabase (guardado en local):', err.message);
        return { success: true, mode: 'local', error: err.message };
      }
    }

    return { success: true, mode: 'local' };
  }

  async getTopScores(limit = 10) {
    if (this.client) {
      try {
        const { data, error } = await this.client
          .from(this.tableName)
          .select('*')
          .order('score_packets', { ascending: false })
          .limit(limit);

        if (!error && data && data.length > 0) {
          this.isOnline = true;
          return { scores: data, source: 'cloud' };
        }
      } catch (e) {
        console.warn('Error obteniendo puntuaciones de Supabase, usando local:', e);
      }
    }

    // Retornar fallback local
    const local = this.getLocalScores();
    return { scores: local.slice(0, limit), source: 'local' };
  }

  saveToLocalStorage(record) {
    const scores = this.getLocalScores();
    scores.push(record);
    scores.sort((a, b) => b.score_packets - a.score_packets);
    localStorage.setItem(this.localLeaderboardKey, JSON.stringify(scores.slice(0, 30)));
  }

  getLocalScores() {
    try {
      const data = localStorage.getItem(this.localLeaderboardKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  initDefaultLocalScores() {
    const defaultScores = [
      { player_name: 'Rodolfo Ramírez', score_packets: 480, weeks_survived: 7, level_name: 'Global Cloud Backbone', created_at: new Date().toISOString() },
      { player_name: 'Jorge del Angel', score_packets: 415, weeks_survived: 6, level_name: 'Metropolitan ISP', created_at: new Date().toISOString() },
      { player_name: 'SysAdmin_Pro', score_packets: 280, weeks_survived: 5, level_name: 'Metropolitan ISP', created_at: new Date().toISOString() },
      { player_name: 'NetEngineer', score_packets: 190, weeks_survived: 3, level_name: 'Campus LAN', created_at: new Date().toISOString() },
      { player_name: 'Junior_Dev', score_packets: 95, weeks_survived: 2, level_name: 'Campus LAN', created_at: new Date().toISOString() }
    ];
    localStorage.setItem(this.localLeaderboardKey, JSON.stringify(defaultScores));
  }
}

export const supabaseService = new SupabaseService();
