// api/stripe-webhook.js

import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw request body
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 1) Read raw body exactly as Stripe sent it
  let rawBody;
  try {
    rawBody = await getRawBody(req, {
      length: req.headers["content-length"],
      limit: "2mb",
      encoding: false, // Buffer
    });
  } catch (e) {
    console.error("Failed to read raw body:", e);
    return res.status(400).send("Invalid body");
  }

  // 2) Get signature + secrets
  const signature =
    req.headers["stripe-signature"] || req.headers["Stripe-Signature"];
  const dashboardSecret = process.env.STRIPE_WEBHOOK_SECRET;        // whsec from Stripe Dashboard (endpoint page)
  const cliSecret = process.env.STRIPE_CLI_WEBHOOK_SECRET || null;  // whsec printed by `stripe listen` (optional)

  if (!dashboardSecret && !cliSecret) {
    console.error("No webhook secret set in env");
    return res.status(500).send("Server misconfigured");
  }

  // 3) Verify with dashboard secret first; if it fails and we have CLI secret, try that
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, dashboardSecret);
  } catch (err1) {
    if (cliSecret) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, cliSecret);
      } catch (err2) {
        console.error("❌ Webhook verify failed (both secrets):", err2.message);
        return res.status(400).send(`Webhook Error: ${err2.message}`);
      }
    } else {
      console.error("❌ Webhook verify failed:", err1.message);
      return res.status(400).send(`Webhook Error: ${err1.message}`);
    }
  }

  // 4) Handle events
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ checkout.session.completed", session.id);
        // TODO: write Firestore subscription status here if needed
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
  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).send("Internal Server Error");
  }
}


