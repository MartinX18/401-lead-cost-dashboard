// Vercel serverless function — admin-only create user.
// Holds the Supabase SERVICE ROLE key server-side (never exposed to the browser).
// Env vars (set in Vercel): SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_EMAILS (comma-separated, optional)
module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ADMINS = (process.env.ADMIN_EMAILS || "marty@401auto.ca").split(",").map(function (s) { return s.trim().toLowerCase(); });
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: "Server not configured (missing SUPABASE_URL or SUPABASE_SERVICE_KEY)" }); return; }

  // 1) verify the caller is a signed-in admin
  var auth = req.headers.authorization || "";
  var token = auth.replace("Bearer ", "").trim();
  if (!token) { res.status(401).json({ error: "Not signed in" }); return; }
  var meRes = await fetch(SB_URL + "/auth/v1/user", { headers: { Authorization: "Bearer " + token, apikey: SB_KEY } });
  if (!meRes.ok) { res.status(401).json({ error: "Invalid session" }); return; }
  var me = await meRes.json();
  if (!me || !me.email || ADMINS.indexOf(me.email.toLowerCase()) === -1) { res.status(403).json({ error: "Not authorized (admins only)" }); return; }

  // 2) read input
  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  var email = (body && body.email ? String(body.email) : "").trim();
  var password = (body && body.password ? String(body.password) : "");
  if (!email || !password) { res.status(400).json({ error: "Email and password are required" }); return; }
  if (password.length < 6) { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }

  // 3) create the user (auto-confirmed, no email sent)
  var createRes = await fetch(SB_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: { Authorization: "Bearer " + SB_KEY, apikey: SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password, email_confirm: true })
  });
  var out = await createRes.json();
  if (!createRes.ok) { res.status(createRes.status).json({ error: (out && (out.msg || out.message)) || ("Create failed: " + JSON.stringify(out)) }); return; }
  res.status(200).json({ ok: true, email: email });
};
