// lib/firebaseAdmin.js
import * as admin from "firebase-admin";

let db;

// Initialize Firebase Admin exactly once per runtime
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}"
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log(
      "🔥 Firebase Admin initialized with:",
      serviceAccount.client_email || "(no client_email)"
    );
  } catch (err) {
    console.error("❌ Failed to init Firebase Admin:", err);
    throw err; // surface to the function -> 500 with a useful log
  }
}

db = admin.firestore();

export { db };

