// api/stripe-webhook.js  (Vercel / Node serverless)

import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // Webhook expects POST only
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
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("✅ checkout.session.completed", session.id);
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




