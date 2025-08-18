// api/db-ping.js
import { db } from "../lib/firebaseAdmin";

export default async function handler(req, res) {
  try {
    // Try to read one document from a "test" collection
    const snapshot = await db.collection("test").limit(1).get();

    res.status(200).json({
      ok: true,
      message: "Connected to Firestore",
      docs_found: snapshot.size,
    });
  } catch (error) {
    console.error("Firestore connection error:", error);
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
}

