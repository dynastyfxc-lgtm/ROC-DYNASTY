// api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js"; // 👈 use your Firestore instance

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// helper: upsert by uid
async function upsertByUid(uid, data) {
  if (!uid) return;
  await db.collection("users").doc(uid).set(
    { ...data, updatedAt: Date.now() },
    { merge: true }
  );
}

// helper: upsert by email (finds first matching user doc)
async function upsertByEmail(email, data) {
  if (!email) return null;
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (snap.empty) return null;
  const ref = snap.docs[0].ref;
  await ref.set({ ...data, updatedAt: Date.now() }, { merge: true });
  return ref.id; // uid if found
}

export default async function handler(req, res) {
  // Webhook expects POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 1) Verify the Stripe signature with the raw body
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

  // 2) Handle events and write to Firestore
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object; // Stripe.Checkout.Session

        const uid = s.metadata?.userId || null; // IMPORTANT: you should pass this in your create-session
        const email = s.customer_details?.email || s.customer_email || null;

        const payload = {
          email: email || null,
          stripeCustomerId: s.customer || null,
          subscription: {
            status: "active", // first invoice paid
            priceId: s?.metadata?.priceId || null,
            current_period_end: null, // will be filled by subscription.updated
          },
        };

        if (uid) {
          await upsertByUid(uid, payload);
        } else if (email) {
          await upsertByEmail(email, payload);
        }

        console.log("✅ checkout.session.completed saved");
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object; // Stripe.Subscription
        const status = sub.status; // active | canceled | trialing | past_due | unpaid ...
        const priceId = sub.items?.data?.[0]?.price?.id || null;
        const current_period_end = sub.current_period_end || null;
        const customerId = sub.customer;

        // Try metadata.userId first (if you add it), else fall back to email via customer lookup
        const uid = sub.metadata?.userId || null;

        let patch = {
          stripeCustomerId: customerId,
          subscription: { status, priceId, current_period_end },
        };

        if (uid) {
          await upsertByUid(uid, patch);
        } else {
          // get customer email, then upsert by email
          try {
            const customer = await stripe.customers.retrieve(customerId);
            const email = customer?.email || null;
            if (email) {
              await upsertByEmail(email, { email, ...patch });
            }
          } catch (e) {
            console.error("⚠️ could not retrieve customer for email:", e.message);
          }
        }

        console.log(`✅ ${event.type} saved`);
        break;
      }

      default:
        // Not critical to store everything; log for visibility
        console.log("⚠️ Unhandled event:", event.type);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Handler error:", err);
    return res.status(500).send("Internal Server Error");
  }
}
