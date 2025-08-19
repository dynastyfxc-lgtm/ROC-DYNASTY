// api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js"; // uses your admin helper

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body
};

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

  // 1) Log every event into Firestore for visibility/audit
  try {
    await db.collection("stripe_events").doc(event.id).set({
      id: event.id,
      type: event.type,
      created: event.created,
      data: event.data?.object ?? null,
      receivedAt: new Date(),
    });
  } catch (err) {
    console.error("Failed to log stripe_event:", err);
    // don't fail the webhook if logging fails
  }

  // 2) Handle important events
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Try to get line items for price/product info (optional but useful)
        let line;
        try {
          const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
          line = items?.data?.[0] || null;
        } catch (e) {
          console.warn("Could not fetch line items:", e?.message);
        }

        // Identify user
        const uid = session.client_reference_id || null;
        const email =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        // Build payment/subscription payload to store
        const payment = {
          sessionId: session.id,
          payment_status: session.payment_status,
          mode: session.mode,                       // "payment" or "subscription"
          amount_total: session.amount_total,        // in cents
          currency: session.currency,
          customer: session.customer || null,
          customer_email: email,
          priceId: line?.price?.id || null,
          productId: line?.price?.product || null,
          quantity: line?.quantity || 1,
          createdAt: new Date(),
        };

        // Find or create the user doc
        let userRef = null;

        if (uid) {
          userRef = db.collection("users").doc(uid);
        } else if (email) {
          const snap = await db.collection("users").where("email", "==", email).limit(1).get();
          if (!snap.empty) {
            userRef = snap.docs[0].ref;
          } else {
            // If you want to auto-create a user doc by email when UID isn't known:
            userRef = db.collection("users").doc();
            await userRef.set({ email, createdAt: new Date() }, { merge: true });
          }
        }

        if (userRef) {
          // Merge payment/subscription info onto the user
          await userRef.set(
            {
              email,
              lastCheckoutAt: new Date(),
              subscription: {
                status: session.payment_status === "paid" ? "active" : session.payment_status,
                mode: session.mode,
                priceId: payment.priceId,
                currentPeriodEnd: null, // can be filled if you manage subscriptions & fetch from stripe.subscriptions
                updatedAt: new Date(),
              },
            },
            { merge: true }
          );

          // Keep a per-payment history under the user
          await userRef.collection("payments").doc(session.id).set(payment);
        } else {
          console.warn(
            "checkout.session.completed: Could not resolve a user doc (no UID/email match).",
            { sessionId: session.id, email }
          );
        }

        break;
      }

      // Add more cases if you wish to keep status in sync:
      // - "customer.subscription.updated"
      // - "customer.subscription.deleted"
      // (similar pattern: resolve user → update subscription fields)
      
      default:
        // nothing special; you’re already logging all events above
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}
