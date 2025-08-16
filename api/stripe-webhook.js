// /api/stripe-webhook.js
import Stripe from "stripe";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } }; // Required for Stripe signature

function db() {
  if (!getApps().length) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    initializeApp({ credential: cert(sa) });
  }
  return getFirestore();
}

async function setSubscriptionStatus(userId, status, extra = {}) {
  if (!userId) return;
  const ref = db().collection("users").doc(userId);
  await ref.set({ subscription: { status, ...extra }, updatedAt: Date.now() }, { merge: true });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const raw = await getRawBody(req);
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const userId = s.metadata?.userId || null;
        await setSubscriptionStatus(userId, "active", {
          checkoutSessionId: s.id,
          customer: s.customer || null,
          mode: s.mode,
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object;
        const userId = sub.metadata?.userId || null;
        await setSubscriptionStatus(userId, sub.status, {
          subscriptionId: sub.id,
          items: sub.items?.data?.map(i => ({ price: i.price?.id, product: i.price?.product })) || [],
          current_period_end: sub.current_period_end,
        });
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const userId = sub.metadata?.userId || null;
        await setSubscriptionStatus(userId, "canceled", {
          subscriptionId: sub.id,
        });
        break;
      }
      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
}


