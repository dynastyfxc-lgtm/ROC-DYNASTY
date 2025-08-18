// lib/firebaseAdmin.js
import * as admin from "firebase-admin";

let db;

if (!admin.apps.length) {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "";
    if (!raw || raw.trim().length < 50) {
      throw new Error(
        "Env var FIREBASE_SERVICE_ACCOUNT_KEY is missing or empty. " +
        "Add it in Vercel → Settings → Environment Variables (Production) and redeploy."
      );
    }

    const serviceAccount = JSON.parse(raw);

    const required = ["project_id", "client_email", "private_key"];
    for (const k of required) {
      if (!serviceAccount[k]) {
        throw new Error(
          `FIREBASE_SERVICE_ACCOUNT_KEY missing required field: "${k}". ` +
          `Double-check the JSON pasted in Vercel (Production) and redeploy.`
        );
      }
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("🔥 Firebase Admin initialized for:", serviceAccount.client_email);
  } catch (err) {
    // This error happens at import-time; it will show in Vercel Runtime Logs.
    console.error("❌ Failed to init Firebase Admin:", err);
    throw err;
  }
}

db = admin.firestore();

export { db };


