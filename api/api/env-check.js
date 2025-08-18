export default function handler(req, res) {
  res.status(200).json({
    FIREBASE_SERVICE_ACCOUNT_KEY: process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      ? "✅ Loaded (not showing full key for safety)"
      : "❌ MISSING",
  });
}
