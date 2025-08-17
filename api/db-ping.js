// api/db-ping.js
import { db } from "../lib/firebaseAdmin.js";

export default async function handler(req, res) {
  try {
    const ref = db.collection("debug").doc("ping");
    await ref.set({ at: Date.now() }, { merge: true });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("db-ping error:", e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

