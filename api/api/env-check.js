// api/env-check.js
export default function handler(req, res) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const ok = !!raw;

  let email = null;
  try {
    if (ok) {
      const obj = JSON.parse(raw);
      email = obj.client_email || null;
    }
  } catch (e) {
    return res.status(200).json({ ok: false, error: "JSON parse failed" });
  }

  return res.status(200).json({ ok, client_email: email });
}
