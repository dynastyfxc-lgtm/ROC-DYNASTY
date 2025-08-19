// /api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js"; // uses your admin helper

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
    // 1) Log raw event for audit/debug
    await db.collection("stripe_events").doc(event.id).set(
      {
        type: event.type,
        created: event.created,
        data: event.data?.object ?? null,
        receivedAt: Date.now(),
      },
      { merge: true }
    );

    // 2) Handle events we care about
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // try the strongest link first
        let uid =
          session.client_reference_id ||
          session.metadata?.uid ||
          null;

        // fallback to email match if no uid
        let email =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        let userRef = null;

        if (uid) {
          userRef = db.collection("users").doc(uid);
        } else if (email) {
          const snap = await db
            .collection("users")
            .where("email", "==", email)
            .limit(1)
            .get();
          if (!snap.empty) {
            userRef = snap.docs[0].ref;
            uid = snap.docs[0].id; // for logging
          }
        }

        if (!userRef) {
          console.warn(
            "checkout.session.completed: no user matched (uid or email).",
            { uid, email, sessionId: session.id }
          );
          break;
        }

        // pull a few helpful fields
        const status =
          session.status || "complete"; // session status (not subscription)
        const mode = session.mode; // "payment" or "subscription"
        const customerId = session.customer || null;
        const subscriptionId = session.subscription || null;
        const priceId =
          session.metadata?.priceId || null; // only if you set it when creating session

        await userRef.set(
          {
            subscription: {
              status,           // for checkout session
              mode,             // "payment" | "subscription"
              customerId,
              subscriptionId,
              priceId,
              email,
              sessionId: session.id,
              updatedAt: Date.now(),
            },
          },
          { merge: true }
        );

        console.log("✅ users updated for checkout.session.completed", {
          uid: uid || "(email match)",
          email,
          sessionId: session.id,
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const customerId = sub.customer;

        // Try to map back to user by email via the Stripe Customer
        // (works well if you're using Payment Links or didn't set client_reference_id)
        let email = null;
        try {
          const customer = await stripe.customers.retrieve(customerId);
          email = customer?.email ?? null;
        } catch (err) {
          console.warn("Could not retrieve customer for subscription:", err.message);
        }

        let userRef = null;
        if (email) {
          const snap = await db
            .collection("users")
            .where("email", "==", email)
            .limit(1)
            .get();
          if (!snap.empty) userRef = snap.docs[0].ref;
        }

        // If you want to support a uid passed via subscription metadata, also try:
        const uid = sub.metadata?.uid || null;
        if (!userRef && uid) userRef = db.collection("users").doc(uid);

        if (!userRef) {
          console.warn("Subscription event but no user matched", {
            type: event.type,
            customerId,
            email,
            uid,
          });
          break;
        }

        await userRef.set(
          {
            subscription: {
              planId:
                sub.items?.data?.[0]?.price?.id || null,
              productId:
                sub.items?.data?.[0]?.price?.product || null,
              status: sub.status, // active, past_due, canceled, etc.
              currentPeriodEnd: sub.current_period_end || null,
              cancelAtPeriodEnd: sub.cancel_at_period_end || false,
              customerId,
              subscriptionId: sub.id,
              updatedAt: Date.now(),
            },
          },
          { merge: true }
        );

        console.log(`✅ users updated for ${event.type}`, {
          email,
          uid,
          subscriptionId: sub.id,
        });
        break;
      }

      default:
        // keep logging everything else to stripe_events
        console.log("⚠️ Unhandled event:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}

