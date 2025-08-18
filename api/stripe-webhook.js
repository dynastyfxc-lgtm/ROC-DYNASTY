import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  let event;
  try {
    const raw = await getRawBody(req);
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Log every event into Firestore
    await db.collection("stripe_events").doc(event.id).set({
      id: event.id,
      type: event.type,
      created: event.created,
      data: event.data?.object ?? null,
      receivedAt: Date.now(),
    });

    // Optional: react to specific events
    switch (event.type) {
      case "checkout.session.completed":
        console.log("✅ Checkout session completed");
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        console.log("🔄 Subscription event:", event.type);
        break;
      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}
