// lib/firebaseAdmin.js
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Reads FIREBASE_SERVICE_ACCOUNT_KEY from env, initializes Admin SDK once,
 * and returns a cached Firestore instance.
 */
let _db;

export function getDb() {
  if (_db) return _db;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY env var is missing");
  }

  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: " + e.message);
  }

  // Handle both one-line and escaped private_key formats
  if (sa.private_key && sa.private_key.includes("\\n")) {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(sa) });
    // Optional: console.log("✅ Firebase Admin initialized");
  }

  _db = getFirestore();
  return _db;
}

/** Upsert helpers used by the webhook (keeps webhook code clean) */
export async function upsertUserByUid(uid, patch) {
  if (!uid) return;
  const db = getDb();
  await db.collection("users").doc(uid).set(
    { ...patch, updatedAt: Date.now() },
    { merge: true }
  );
}

export async function upsertUserByEmail(email, patch) {
  if (!email) return null;
  const db = getDb();
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (snap.empty) return null;

  const doc = snap.docs[0];
  await doc.ref.set({ ...patch, updatedAt: Date.now() }, { merge: true });
  return doc.id; // returns the uid if found
}
