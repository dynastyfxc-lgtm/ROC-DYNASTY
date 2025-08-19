// api/create-checkout-session.js
// Creates a Stripe Checkout Session for a subscription (or one-time if you change mode)
// Accepts JSON body: { priceId, userId, email, successUrl, cancelUrl }
// Returns: { url, id }

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- very simple CORS so Webflow can call this function ---
function setCORS(req, res) {
  const origin = req.headers.origin || "*";
  // You can lock this down to your Webflow and custom domains if you like:
  // const allowed = ["https://YOUR-SITE.webflow.io", "https://www.YOURDOMAIN.com"];
  // const allow = allowed.includes(origin) ? origin : allowed[0];
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin"); // for caches
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCORS(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { priceId, userId, email, successUrl, cancelUrl } = req.body || {};

    if (!priceId) {
      return res.status(400).json({ error: "Missing priceId" });
    }

    // Build the Checkout Session
    const session = await stripe.checkout.sessions.create({
      // Change to "payment" for one-time; leave "subscription" for recurring
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],

      // Where to send the user after success/cancel
      success_url:
        successUrl ||
        `${req.headers.origin || "https://roc-dynasty-l3sl.vercel.app"}/app`,
      cancel_url:
        cancelUrl ||
        `${req.headers.origin || "https://roc-dynasty-l3sl.vercel.app"}/billing`,

      // These help the webhook attach the purchase to your user
      client_reference_id: userId || null, // Firebase UID if you have it
      customer_email: email || undefined,  // nice fallback if UID isn't present
      metadata: {
        uid: userId || "",
        priceId,
        source: "webflow", // optional, for your own analytics
      },

      // Nice defaults
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      automatic_tax: { enabled: true },
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return res.status(500).json({ error: err.message });
  }
}
