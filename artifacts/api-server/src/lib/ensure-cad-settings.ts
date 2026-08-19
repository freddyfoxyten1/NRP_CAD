import { isMongoStore, pool, settingsRepo } from "@workspace/db";
import { getCadMode } from "./cad-mode";

let ready: Promise<void> | null = null;

/** cad_settings is required for Discord login (terminal mode) and public CAD status. */
export function ensureCadSettingsTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (isMongoStore()) {
        await settingsRepo.ensureDefaultSettings();
        await getCadMode();
        return;
      }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS cad_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(
        `INSERT INTO cad_settings (key, value) VALUES ('cad_online', 'true')
         ON CONFLICT (key) DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO cad_settings (key, value) VALUES ('cad_mode', 'online')
         ON CONFLICT (key) DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO cad_settings (key, value) VALUES ('self_dispatch', 'false')
         ON CONFLICT (key) DO NOTHING`,
      );
      await getCadMode();
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
