import { createStorage } from 'unstorage';
import fsDriver from 'unstorage/drivers/fs';

// Simple string:string store for entity descriptions.
// Key examples: '1.2.3.4' (IP address) or 'IP:sess-123' (IP + session id pair)
// Value: short text description (sanitized, no newlines, max ~256 chars)

const storage = createStorage({ driver: fsDriver({ base: 'storage/entity-descriptions' }) });
const PREFIX = 'entity:'; // stored keys become entity:<id>

function sanitizeKey(key: string): string {
  return key.trim();
}

function sanitizeValue(val: string): string {
  // Collapse whitespace, trim, limit length, remove control chars
  const cleaned = val.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned.slice(0, 256);
}

// Set description (overwrites existing)
export async function setEntityDescription(id: string, description: string): Promise<boolean> {
  const key = sanitizeKey(id);
  if (!key) return false;
  const value = sanitizeValue(description);
  try {
    await storage.setItem(PREFIX + key, value);
    return true;
  } catch (e) {
    console.error('entity-description set error', (e as Error).message);
    return false;
  }
}

// Get description; returns null if missing
export async function getEntityDescription(id: string): Promise<string | null> {
  const key = sanitizeKey(id);
  if (!key) return null;
  try {
    const val = await storage.getItem<string>(PREFIX + key);
    if (typeof val !== 'string') return null;
    return val;
  } catch (e) {
    console.error('entity-description get error', (e as Error).message);
    return null;
  }
}

// Remove description
export async function removeEntityDescription(id: string): Promise<boolean> {
  const key = sanitizeKey(id);
  if (!key) return false;
  try {
    await storage.removeItem(PREFIX + key);
    return true;
  } catch (e) {
    console.error('entity-description remove error', (e as Error).message);
    return false;
  }
}

// List all entity ids currently stored (without prefix)
export async function listEntityIds(): Promise<string[]> {
  try {
    const keys = await storage.getKeys(PREFIX);
    return keys.map(k => k.substring(PREFIX.length));
  } catch (e) {
    console.error('entity-description list error', (e as Error).message);
    return [];
  }
}
