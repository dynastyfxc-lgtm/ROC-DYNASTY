// api/stripe-webhook.js  (Vercel serverless / Node)
// - Logs every event -> stripe_events
// - Updates users collection on key subscription events

import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js";
import admin from "firebase-admin";

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-07-30.basil",
});

// ---------- helpers ----------
const { FieldValue } = admin.firestore;

async function upsertStripeEvent(event) {
  const ref = db.collection("stripe_events").doc(event.id);
  await ref.set(
    {
      id: event.id,
      type: event.type,
      created: event.created,
      receivedAt: FieldValue.serverTimestamp(),
      data: event.data?.object ?? null,
    },
    { merge: true }
  );
}

async function findUserRef({ userId, customerId, email }) {
  // 1) explicit userId from Checkout metadata (best)
  if (userId) {
    return db.collection("users").doc(userId);
  }

  // 2) match by stripeCustomerId (recommended)
  if (customerId) {
    const snap = await db
      .collection("users")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].ref;
  }

  // 3) last resort: match by email
  if (email) {
    const snap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].ref;
  }

  return null;
}

async function updateUserFromSubscription({ userRef, sub }) {
  const item = sub.items?.data?.[0];
  await userRef.set(
    {
      subscriptionId: sub.id,
      subscriptionStatus: sub.status, // active, trialing, past_due, canceled, etc.
      priceId: item?.price?.id ?? null,
      productId: item?.price?.product ?? null,
      currentPeriodEnd: sub.current_period_end ? sub.current_period_end * 1000 : null,
      stripeCustomerId: sub.customer ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// ---------- webhook handler ----------
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
    console.error("❌ Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // 1) ALWAYS log the event
    await upsertStripeEvent(event);

    // 2) Handle important events
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        const userId = session.metadata?.userId ?? null;
        const email =
          session.customer_details?.email ||
          session.customer_email ||
          null;
        const customerId = session.customer ?? null;

        const userRef = await findUserRef({ userId, customerId, email });
        if (!userRef) {
          console.warn(
            "⚠️ No matching user found for checkout.session.completed",
            { userId, customerId, email }
          );
          break;
        }

        // If a subscription was created via Checkout, fetch it
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await updateUserFromSubscription({ userRef, sub });
        } else {
          // one-time payment: store customer id at least
          await userRef.set(
            {
              stripeCustomerId: customerId,
              lastPaymentIntentId: session.payment_intent ?? null,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;

        const userRef = await findUserRef({
          userId: null,
          customerId: sub.customer,
          email: null,
        });
        if (!userRef) {
          console.warn("⚠️ No matching user found for subscription event", {
            customerId: sub.customer,
          });
          break;
        }

        await updateUserFromSubscription({ userRef, sub });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const userRef = await findUserRef({ userId: null, customerId, email: null });
        if (!userRef) break;

        await userRef.set(
          {
            lastPaymentFailedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        break;
      }

      default:
        // keep unhandled events logged only
        console.log("ℹ️ Unhandled event:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("🔥 Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}
