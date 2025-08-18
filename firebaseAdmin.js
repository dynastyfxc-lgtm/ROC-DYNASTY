// lib/firebaseAdmin.js
// ESM-friendly, single-init Firebase Admin for Vercel functions

import { getApps, getApp, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let app;

// Parse service account JSON from env
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}';
const sa = JSON.parse(raw);

// Fix escaped newlines in private_key (\\n -> \n)
if (sa.private_key && sa.private_key.includes('\\n')) {
  sa.private_key = sa.private_key.replace(/\\n/g, '\n');
}

if (!getApps().length) {
  app = initializeApp({
    credential: cert(sa),
  });
  console.log('🔥 Firebase Admin initialized for:', sa.client_email || '(no client_email)');
} else {
  app = getApp();
}

export const db = getFirestore(app);



