import { createStorage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import * as v from "valibot";

const ipsSchema = v.array(v.string());

// In-memory IP address key-value store (simple list of IPs)
// Accepts only IPv4 dotted quads; prevents duplicates.
const ipStore: string[] = [];

export function getIpStore() {
  return ipStore;
}

export function addIp(ip: string) {
  const trimmed = ip.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return false;
  if (!ipStore.includes(trimmed)) ipStore.push(trimmed);
  return true;
}

export function removeIp(ip: string) {
  const idx = ipStore.indexOf(ip.trim());
  if (idx === -1) return false;
  ipStore.splice(idx, 1);
  return true;
}
const storage = createStorage({ driver: fsDriver({ base: "storage" }) });
const STORAGE_IPS_KEY_NEW = "ips.json";

export async function loadIps() {
  const result = v.safeParse(
    ipsSchema,
    await storage.getItem(STORAGE_IPS_KEY_NEW),
  );
  if (result.success) {
    result.output.forEach((v) => addIp(v));
    return;
  }
  console.warn("ips schema validation failed", result);
}

export async function persistIps() {
  try {
    await storage.setItem(STORAGE_IPS_KEY_NEW, [...ipStore]);
    console.log("Persist ips stored", { count: ipStore.length });
  } catch (e) {
    console.error("Persist ips storage failed", (e as Error).message);
  }
}

export async function doesIpExist(ip: string) {
  return ipStore.includes(ip.trim());
}
