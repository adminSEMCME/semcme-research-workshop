import { query } from './db.js';
import { config } from './config.js';

export async function getWorkshopSettings() {
  const { rows } = await query("SELECT value, updated_at FROM rws_settings WHERE key = 'registration'");
  const saved = rows[0];
  return {
    eventId: config.constantContact.eventId || '',
    trackKey: config.constantContact.trackKey || '',
    registrationUrl: config.registrationUrl,
    ...saved?.value,
    updatedAt: saved?.updated_at ? new Date(saved.updated_at).toISOString() : null,
  };
}

export function validateWorkshopSettings(input) {
  const eventId = String(input.eventId || '').trim();
  const trackKey = String(input.trackKey || '').trim();
  const registrationUrl = String(input.registrationUrl || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(eventId)) throw Object.assign(new Error('Enter the Constant Contact event ID, not the campaign name or a URL.'), { status: 400 });
  if (trackKey && !/^[a-zA-Z0-9_-]{1,200}$/.test(trackKey)) throw Object.assign(new Error('Enter a valid registration track key or leave it blank.'), { status: 400 });
  let url;
  try { url = new URL(registrationUrl); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('Enter the full HTTPS registration page URL.'), { status: 400 });
  return { eventId, trackKey, registrationUrl };
}

export async function saveWorkshopSettings(settings) {
  await query(`INSERT INTO rws_settings (key, value) VALUES ('registration', $1::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`, [JSON.stringify(settings)]);
  return getWorkshopSettings();
}

export function registrationNeedsRecheck(user, settings, minutes = config.constantContact.registrationRecheckMinutes) {
  const synced = user?.synced_at ? new Date(user.synced_at).getTime() : NaN;
  if (!Number.isFinite(synced)) return true;
  // A campaign save forces revalidation even when periodic rechecks are disabled.
  if ((user?.registration_revision || '') !== (settings.updatedAt || '')) return true;
  return Boolean(minutes) && Date.now() - synced > minutes * 60000;
}
