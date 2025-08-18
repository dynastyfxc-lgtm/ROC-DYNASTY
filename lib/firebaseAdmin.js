// lib/firebaseAdmin.js
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  // ✅ Safe debug log (only shows client email, not private key)
  console.log("🔥 Firebase Admin initialized with:", serviceAccount.client_email);
}

const db = admin.firestore();

export { db };
