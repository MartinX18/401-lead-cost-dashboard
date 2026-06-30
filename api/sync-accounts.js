// /api/sync-accounts.js
// Token-gated upsert of the Google Ads account list into the Supabase ad_accounts table.
// Called by the daily morning-brief task AFTER it runs Supermetrics accounts_discovery.
// The service_role key never leaves the server; the caller only holds SYNC_TOKEN.
module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const token = req.headers["x-sync-token"];
  if (!process.env.SYNC_TOKEN || token !== process.env.SYNC_TOKEN) {
    res.status(401).json({ error: "bad token" }); return;
  }

  const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: "server missing supabase env" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const accounts = (body && Array.isArray(body.accounts)) ? body.accounts : [];
  const clean = accounts
    .map(a => ({ account_id: String((a && a.account_id) || "").trim(),
                 store_name: String((a && a.store_name) || "").slice(0, 120) }))
    .filter(a => a.account_id);
  if (!clean.length) { res.status(400).json({ error: "no accounts provided" }); return; }

  const now = new Date().toISOString();
  const rows = clean.map(a => ({ account_id: a.account_id, store_name: a.store_name, active: true, updated_at: now }));

  const up = await fetch(SB_URL + "/rest/v1/ad_accounts?on_conflict=account_id", {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  if (!up.ok) { const t = await up.text(); res.status(502).json({ error: "supabase " + up.status, detail: t.slice(0, 300) }); return; }

  let deactivated = false;
  if (body && body.deactivate_missing) {
    const ids = clean.map(a => a.account_id).join(",");
    const d = await fetch(SB_URL + "/rest/v1/ad_accounts?account_id=not.in.(" + ids + ")", {
      method: "PATCH",
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY,
        "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ active: false, updated_at: now })
    });
    deactivated = d.ok;
  }

  res.status(200).json({ ok: true, upserted: rows.length, deactivated: deactivated });
};
