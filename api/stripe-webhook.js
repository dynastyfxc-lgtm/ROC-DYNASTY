// api/stripe-webhook.js  (Vercel / Node serverless)

import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = {
  api: { bodyParser: false }, // Stripe requires the raw body (no JSON parsing)
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // apiVersion: "2025-07-30.basil", // optional, keep if you want to pin
});

export default async function handler(req, res) {
  // Webhook expects POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // --- read raw body exactly as sent ---
  let rawBody;
  try {
    rawBody = await getRawBody(req, {
      length: req.headers["content-length"],
      limit: "2mb",
      encoding: false, // return a Buffer
    });
  } catch (e) {
    console.error("Failed to read raw body:", e);
    return res.status(400).send("Invalid body");
  }

  const signature =
    req.headers["stripe-signature"] || req.headers["Stripe-Signature"];

  // Support either the dashboard endpoint secret or a CLI secret (if you use `stripe listen`)
  const primarySecret = process.env.STRIPE_WEBHOOK_SECRET;           // whsec_... from Dashboard → your endpoint
  const cliSecret = process.env.STRIPE_CLI_WEBHOOK_SECRET || null;   // whsec_... printed by `stripe listen`
  const secrets = [primarySecret, cliSecret].filter(Boolean);

  if (secrets.length === 0) {
    console.error("No webhook secret set in env");
    return res.status(500).send("Server misconfigured");
  }

  let event;
  try {
    // Stripe SDK accepts an array of secrets (helps with rotation / CLI vs Dashboard)
    event = stripe.webhooks.constructEvent(rawBody, signature, secrets);
  } catch (err) {
    console.error("❌ Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // --- handle events ---
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ checkout.session.completed", session.id);
        // TODO: write Firestore subscription status here (if desired)
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        console.log(`✅ ${event.type}`, sub.id);
        break;
      }
      default:
        console.log("⚠️ Unhandled event:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}


