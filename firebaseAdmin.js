// lib/firebaseAdmin.js
import admin from 'firebase-admin';

let app;

// Only initialize once (Vercel can reuse the same instance)
if (!admin.apps.length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!sa) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is missing');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(sa);
  } catch (e) {
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', e);
    throw e;
  }

  // Optional: small safe log to verify which identity is used
  console.log('🔥 Firebase Admin initializing with:', serviceAccount.client_email);

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  app = admin.app();
}

export const db = admin.firestore();

