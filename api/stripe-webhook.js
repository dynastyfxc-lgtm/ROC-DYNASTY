// api/stripe-webhook.js
// Purpose: Verify Stripe signature and log every event to Firestore.
// After we confirm events are arriving, we'll add user/subscription updates.

import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js"; // Firestore helper you created

export const config = {
  api: { bodyParser: false }, // Stripe requires raw body for signature verification
};

// Initialize Stripe with your secret key from Vercel env
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // 1) Only accept POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 2) Verify the webhook signature
  let event;
  try {
    const raw = await getRawBody(req);
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("❌ Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 3) Log the event to Firestore for visibility
  try {
    await db.collection("stripe_events").doc(event.id).set({
      type: event.type,
      api_version: event.api_version || null,
      created: event.created,
      data: event.data?.object ?? null,
      receivedAt: Date.now(),
    });
    console.log(`✅ Logged ${event.type} to Firestore: ${event.id}`);
  } catch (err) {
    console.error("❌ Firestore write failed:", err.message);
    // We still return 200 to avoid Stripe retry storms while you fix Firestore issues
  }

  // 4) (Optional) Minimal routing for your own logs — no writes yet
  switch (event.type) {
    case "checkout.session.completed":
      console.log("ℹ️ checkout.session.completed received");
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      console.log("ℹ️ subscription lifecycle event:", event.type);
      break;
    default:
      console.log("ℹ️ unhandled event:", event.type);
  }

  // 5) Ack to Stripe
  return res.status(200).json({ received: true });
}

