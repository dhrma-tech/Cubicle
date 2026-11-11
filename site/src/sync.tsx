import { useEffect, useState } from "react";
import { toast } from "./components";

/* Optional sync: everything is encrypted in the browser (AES-GCM, key from a passphrase via PBKDF2) before it leaves.
   The server stores one opaque blob under an id derived from the same passphrase. Lose the passphrase and the blob is unreadable. */
const KEYS = ["devtube:v1", "devtube.study.v1", "devtube.scroll.v1", "devtube.ai.v1"];
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, "0")).join("");

async function derive(pass: string) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode("devtube-sync-v1"), iterations: 250_000, hash: "SHA-256" }, base, 512));
  const key = await crypto.subtle.importKey("raw", bits.slice(32), "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id: hex(bits.slice(0, 32)), key };
}

function collect() {
  const o: Record<string, unknown> = {};
  for (const k of KEYS) {
    const raw = localStorage.getItem(k); if (!raw) continue;
    try { const j = JSON.parse(raw); if (k === "devtube.ai.v1") delete j.key; o[k] = j; } catch { /* skip unreadable */ }
  }
  return o;
}

async function seal(pass: string) {
  const { id, key } = await derive(pass);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify({ v: 1, at: Date.now(), d: collect() }))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return { id, data: b64(out) };
}
async function open(pass: string, data: string) {
  const { key } = await derive(pass);
  const raw = unb64(data);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
  return JSON.parse(dec.decode(pt)) as { v: number; at: number; d: Record<string, unknown> };
}

export function SyncPanel() {
  const [on, setOn] = useState<boolean | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { fetch("./api/sync?status=1").then((r) => setOn(r.ok)).catch(() => setOn(false)); }, []);
  const ok = pass.length >= 8 && !busy;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(""); try { await fn(); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); } };
  const push = () => run(async () => {
    const { id, data } = await seal(pass);
    const r = await fetch("./api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, data }) });
    if (!r.ok) throw new Error(r.status === 413 ? "Your data is too large to sync." : "Could not save to the sync store.");
    setMsg("Pushed. Open this page on your other device and press Pull with the same passphrase."); toast("Synced to the cloud");
  });
  const pull = () => run(async () => {
    const { id } = await derive(pass);
    const r = await fetch(`./api/sync?id=${id}`);
    if (r.status === 404) throw new Error("Nothing is stored for this passphrase yet. Push from your other device first.");
    if (!r.ok) throw new Error("Could not reach the sync store.");
    const j = (await r.json()) as { data: string; updated_at: string };
    let b; try { b = await open(pass, j.data); } catch { throw new Error("Could not decrypt. Check the passphrase."); }
    if (!confirm(`Replace the data in this browser with the copy from ${new Date(j.updated_at).toLocaleString()}? Your AI key stays as it is.`)) return;
    for (const [k, v] of Object.entries(b.d)) {
      if (k === "devtube.ai.v1") { let mine = {}; try { mine = JSON.parse(localStorage.getItem(k) || "{}"); } catch { /* ignore */ } localStorage.setItem(k, JSON.stringify({ ...(v as object), key: (mine as { key?: string }).key || "" })); }
      else localStorage.setItem(k, JSON.stringify(v));
    }
    location.reload();
  });
  return (
    <fieldset className="set">
      <legend>Sync across devices</legend>
      {on === false ? <p className="hint">Sync is not enabled on this site. The site owner can turn it on by adding a Supabase store (see the README).</p> : (
        <>
          <p className="hint">Optional. Your progress, notes, queue and plan are encrypted in this browser with your passphrase before they leave it. Nobody, including the site owner, can read them. There is no recovery: forget the passphrase and the copy is lost.</p>
          <label className="sync-pass">Passphrase (8 characters or more)
            <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <div className="btnrow">
            <button className="btn" type="button" disabled={!ok || on === null} onClick={push}>Push this device</button>
            <button className="btn" type="button" disabled={!ok || on === null} onClick={pull}>Pull to this device</button>
          </div>
          <p role="status" className="msg">{busy ? "Working..." : msg}</p>
        </>
      )}
    </fieldset>
  );
}
