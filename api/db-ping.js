// api/db-ping.js
import { db } from '../lib/firebaseAdmin.js';

export default async function handler(req, res) {
  try {
    const ref = db.collection('__health').doc('ping');
    const ts = Date.now();

    // write + read to verify Firestore access
    await ref.set({ ts }, { merge: true });
    const snap = await ref.get();

    return res.status(200).json({
      ok: true,
      wrote: ts,
      read: snap.exists ? snap.data() : null,
    });
  } catch (err) {
    console.error('db-ping error:', err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}

