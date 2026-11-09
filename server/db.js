import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_DB_FILE = path.join(DATA_DIR, 'wedding_rsvps.json');
const TMP_DB_FILE = path.join(os.tmpdir(), 'wedding_rsvps.json');

const HOME_DB_DIR = path.join(os.homedir(), '.wedding_portal');
const HOME_DB_FILE = path.join(HOME_DB_DIR, 'wedding_rsvps.json');

// Check if local project data directory is writable (writable locally, read-only on Vercel)
let isLocalDirWritable = false;
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_FILE)) {
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  fs.accessSync(DATA_DIR, fs.constants.W_OK);
  isLocalDirWritable = true;
} catch {
  isLocalDirWritable = false;
}

try {
  if (!fs.existsSync(HOME_DB_DIR)) {
    fs.mkdirSync(HOME_DB_DIR, { recursive: true });
  }
} catch {}

// In-memory cache across serverless warm requests
globalThis.__weddingRsvpsCache = globalThis.__weddingRsvpsCache || null;

// Check Supabase credentials
const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

let supabase = null;
if (isSupabaseConfigured) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });
    console.log('[Database] Initialized with Supabase Cloud at', supabaseUrl);
    // Background sync on startup to guarantee local store has all cloud records
    supabase
      .from('rsvps')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && Array.isArray(data) && data.length > 0) {
          console.log(`[Database] Auto-synced ${data.length} records from Supabase into local store.`);
          writeLocalStore(data);
        }
      })
      .catch((err) => {
        console.warn('[Database] Initial Supabase background sync notice:', err.message);
      });
  } catch (err) {
    console.error('[Database] Failed to initialize Supabase client:', err.message);
    supabase = null;
  }
} else {
  console.log('[Database] Supabase credentials not found. Using local/tmp persistent storage.');
}

// In-memory set of deleted IDs (tombstones) to prevent revived deleted records across candidate files
const tombstoneIds = new Set();

// Helper for writing local JSON store to all redundant locations with atomic writes
function writeLocalStore(records) {
  globalThis.__weddingRsvpsCache = records;
  let wroteSuccessfully = false;

  const candidateFiles = [LOCAL_DB_FILE, HOME_DB_FILE, TMP_DB_FILE];

  for (const filePath of candidateFiles) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Atomic write pattern: write to temporary file first then rename
      const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(records, null, 2), 'utf-8');
      fs.renameSync(tempPath, filePath);
      wroteSuccessfully = true;
    } catch (err) {
      // Direct write fallback if atomic rename is restricted
      try {
        fs.writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
        wroteSuccessfully = true;
      } catch (e) {
        // Ignored for read-only environments
      }
    }
  }

  return wroteSuccessfully;
}

// Helper for reading and merging local JSON store from all redundant locations
function readLocalStore() {
  const recordsMap = new Map();
  const candidateFiles = [LOCAL_DB_FILE, HOME_DB_FILE, TMP_DB_FILE];

  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && item.id && !tombstoneIds.has(item.id) && !recordsMap.has(item.id)) {
              recordsMap.set(item.id, item);
            }
          }
        }
      } catch (err) {
        console.warn(`[Database] Warning reading store from ${filePath}:`, err.message);
      }
    }
  }

  // Also include in-memory cache if any items exist
  if (Array.isArray(globalThis.__weddingRsvpsCache)) {
    for (const item of globalThis.__weddingRsvpsCache) {
      if (item && item.id && !tombstoneIds.has(item.id) && !recordsMap.has(item.id)) {
        recordsMap.set(item.id, item);
      }
    }
  }

  const allRecords = Array.from(recordsMap.values()).sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );

  globalThis.__weddingRsvpsCache = allRecords;

  // Synchronize across all candidate storage locations
  for (const filePath of candidateFiles) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(allRecords, null, 2), 'utf-8');
    } catch (e) {}
  }

  return allRecords;
}

export const db = {
  isCloud: isSupabaseConfigured,

  /**
   * Save a new RSVP record
   */
  async saveRsvp(rsvpData) {
    const recordId =
      rsvpData.id &&
      typeof rsvpData.id === 'string' &&
      !rsvpData.id.startsWith('pending-') &&
      !rsvpData.id.startsWith('local-')
        ? rsvpData.id
        : crypto.randomUUID();

    const record = {
      id: recordId,
      guest_name: (rsvpData.guest_name && String(rsvpData.guest_name).trim()) || 'Valued Guest',
      guest_email: (rsvpData.guest_email && String(rsvpData.guest_email).trim().toLowerCase()) || '',
      phone_number: rsvpData.phone_number && String(rsvpData.phone_number).trim() ? String(rsvpData.phone_number).trim() : null,
      attendance_status: rsvpData.attendance_status === 'declined' ? 'declined' : 'attending',
      attendees_count: rsvpData.attendance_status === 'attending' ? parseInt(rsvpData.attendees_count, 10) || 1 : 0,
      additional_guests: rsvpData.additional_guests ? String(rsvpData.additional_guests).trim() : '',
      selected_events: Array.isArray(rsvpData.selected_events) ? rsvpData.selected_events : [],
      dietary_requirements: rsvpData.dietary_requirements ? String(rsvpData.dietary_requirements).trim() : '',
      special_requests: rsvpData.special_requests ? String(rsvpData.special_requests).trim() : '',
      ip_address: rsvpData.ip_address || 'unknown',
      created_at: rsvpData.created_at || new Date().toISOString(),
    };

    // If Supabase is active, persist to cloud PostgreSQL
    if (supabase) {
      try {
        const { data, error } = await supabase.from('rsvps').insert([record]).select().single();
        if (error) {
          console.warn('[Database] Supabase insert failed, falling back to local file store:', error.message);
        } else {
          console.log('[Database] Saved RSVP to Supabase:', data.id);
          const current = readLocalStore();
          // Avoid duplicate in local store
          const filtered = current.filter((r) => r.id !== record.id);
          filtered.unshift(record);
          writeLocalStore(filtered);
          return record;
        }
      } catch (err) {
        console.warn('[Database] Exception on Supabase insert:', err.message);
      }
    }

    // Default or fallback: Save to local persistent JSON file / tmp store
    const records = readLocalStore();
    const filtered = records.filter((r) => r.id !== record.id);
    filtered.unshift(record);
    writeLocalStore(filtered);
    console.log('[Database] Saved RSVP to database:', record.id, record.guest_name);
    return record;
  },

  /**
   * Retrieve all RSVPs (Admin only)
   */
  async getAllRsvps() {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('rsvps')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && Array.isArray(data) && data.length > 0) {
          const valid = data.filter((r) => !tombstoneIds.has(r.id));
          writeLocalStore(valid);
          return valid;
        }
      } catch (err) {
        console.warn('[Database] Supabase fetch error, using local store:', err.message);
      }
    }

    return readLocalStore();
  },

  /**
   * Calculate RSVP summary metrics
   */
  async getStats() {
    const rsvps = await this.getAllRsvps();

    let totalSubmissions = rsvps.length;
    let attendingSubmissions = 0;
    let declinedSubmissions = 0;
    let totalExpectedAttendees = 0;

    const eventCounts = {
      mehendi: 0,
      sangeeth: 0,
      haldi: 0,
      pelli_rituals: 0,
      wedding: 0,
    };

    for (const rsvp of rsvps) {
      if (rsvp.attendance_status === 'attending') {
        attendingSubmissions++;
        const count = parseInt(rsvp.attendees_count, 10) || 1;
        totalExpectedAttendees += count;

        if (Array.isArray(rsvp.selected_events)) {
          const accountedEvents = new Set();
          for (const evId of rsvp.selected_events) {
            // Map legacy IDs if any exist
            let mappedIds = [evId];
            if (evId === 'mehendi_sangeeth') {
              mappedIds = ['mehendi', 'sangeeth'];
            } else if (evId === 'haldi_pelli') {
              mappedIds = ['haldi', 'pelli_rituals'];
            } else if (evId === 'wedding_ceremony') {
              mappedIds = ['wedding'];
            } else if (evId === 'pelli_ceremony') {
              mappedIds = ['pelli_rituals'];
            }

            for (const targetId of mappedIds) {
              if (eventCounts[targetId] !== undefined && !accountedEvents.has(targetId)) {
                accountedEvents.add(targetId);
                eventCounts[targetId] += count;
              }
            }
          }
        }
      } else {
        declinedSubmissions++;
      }
    }

    return {
      totalSubmissions,
      attendingSubmissions,
      declinedSubmissions,
      totalExpectedAttendees,
      eventCounts,
    };
  },

  /**
   * Delete RSVP by ID (Admin only)
   */
  async deleteRsvp(id) {
    tombstoneIds.add(id);

    if (supabase) {
      try {
        await supabase.from('rsvps').delete().eq('id', id);
      } catch (err) {
        console.warn('[Database] Supabase delete error:', err.message);
      }
    }

    const current = readLocalStore();
    const updated = current.filter((r) => r.id !== id);
    writeLocalStore(updated);
    return true;
  },
};
