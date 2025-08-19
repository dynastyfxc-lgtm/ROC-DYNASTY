// api/stripe-webhook.js
// - Verifies Stripe signature
// - Logs EVERY event to Firestore: stripe_events/{eventId}
// - De-dupes already-processed events
// - Updates users/{uid}.subscription on checkout + subscription lifecycle

import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js";

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // ---------- 1) Verify event ----------
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
    // ---------- 2) Log event + prepare de-dupe ----------
    const evtRef = db.collection("stripe_events").doc(event.id);
    await evtRef.set(
      {
        type: event.type,
        created: event.created,
        data: event.data?.object ?? null,
        receivedAt: Date.now(),
      },
      { merge: true }
    );

    // De-dupe: if processed before, exit early
    const already = (await evtRef.get()).data()?.processedAt;
    if (already) {
      return res.status(200).json({ received: true, deduped: true });
    }

    // ---------- 3) Handle events we care about ----------
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Resolve user: prefer UID, else email
        let uid =
          session.client_reference_id ||
          session.metadata?.uid ||
          null;

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
          console.warn("⚠️ checkout.session.completed: no user matched", {
            uid,
            email,
            sessionId: session.id,
          });
          break;
        }

        // Basic status/ids
        const status = session.status || "complete";
        const mode = session.mode; // "payment" | "subscription"
        const customerId = session.customer || null;
        const subscriptionId = session.subscription || null;

        // Enrich price/product/interval/amount if not supplied via metadata
        let priceId = session.metadata?.priceId || null;
        let productId = null;
        let interval = null;
        let unitAmount = null;
        let planNickname = null;

        try {
          if (!priceId) {
            const full = await stripe.checkout.sessions.retrieve(session.id, {
              expand: ["line_items.data.price.product"],
            });
            const li = full.line_items?.data?.[0];
            const price = li?.price;
            priceId = price?.id || null;
            productId = price?.product?.id || price?.product || null;
            interval = price?.recurring?.interval || null;
            unitAmount = price?.unit_amount || null;
            planNickname = price?.nickname || price?.product?.name || null;
          }
        } catch (e) {
          console.warn("Could not expand line_items:", session.id, e.message);
        }

        await userRef.set(
          {
            email,
            stripeCustomerId: customerId || null, // keep mapping for future events
            subscription: {
              status,
              mode,
              customerId,
              subscriptionId,
              priceId,
              productId,
              interval,
              unitAmount,
              planNickname,
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

        // Try to resolve user by email via Customer (works with Payment Links)
        let email = null;
        try {
          const customer = await stripe.customers.retrieve(customerId);
          email = customer?.email ?? null;
        } catch (err) {
          console.warn("Could not retrieve customer:", err.message);
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

        // Also support a uid placed in subscription metadata
        const uid = sub.metadata?.uid || null;
        if (!userRef && uid) userRef = db.collection("users").doc(uid);

        // Also try mapping by stored stripeCustomerId
        if (!userRef && customerId) {
          const snap = await db
            .collection("users")
            .where("stripeCustomerId", "==", customerId)
            .limit(1)
            .get();
          if (!snap.empty) userRef = snap.docs[0].ref;
        }

        if (!userRef) {
          console.warn("⚠️ Subscription event but no user matched", {
            type: event.type,
            customerId,
            email,
            uid,
          });
          break;
        }

        // Extract plan/price details
        const li = sub.items?.data?.[0];
        const price = li?.price;
        const planId = price?.id || null;
        const productId = price?.product || null;
        const interval = price?.recurring?.interval || null;
        const unitAmount = price?.unit_amount || null;

        const patch = {
          stripeCustomerId: customerId || null, // persist mapping for future
          subscription: {
            planId,
            productId,
            interval,
            unitAmount,
            status: sub.status, // active, past_due, canceled, etc.
            currentPeriodEnd: sub.current_period_end || null,
            cancelAtPeriodEnd: sub.cancel_at_period_end || false,
            customerId,
            subscriptionId: sub.id,
            updatedAt: Date.now(),
          },
        };

        if (event.type === "customer.subscription.deleted") {
          patch.subscription.status = "canceled";
          patch.subscription.canceledAt = Date.now();
        }

        await userRef.set(patch, { merge: true });

        console.log(`✅ users updated for ${event.type}`, {
          email,
          uid,
          subscriptionId: sub.id,
        });
        break;
      }

      default: {
        console.log("ℹ️ Unhandled event:", event.type);
        break;
      }
    }

    // ---------- 4) Mark processed (for de-dupe) ----------
    await evtRef.set({ processedAt: Date.now() }, { merge: true });

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("🔥 Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}


