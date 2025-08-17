// api/stripe-webhook.js
import Stripe from "stripe";
import getRawBody from "raw-body";
import { db } from "../lib/firebaseAdmin.js"; // Firestore from our new helper

export const config = {
  api: { bodyParser: false }, // Stripe needs the raw body to verify the signature
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ----- small Firestore helpers -----
async function upsertByUid(uid, patch) {
  if (!uid) return;
  await db.collection("users").doc(uid).set(
    { ...patch, updatedAt: Date.now() },
    { merge: true }
  );
}

async function upsertByEmail(email, patch) {
  if (!email) return null;
  const snap = await db.collection("users").where("email", "==", email).limit(1).get();
  if (snap.empty) return null;
  const ref = snap.docs[0].ref;
  await ref.set({ ...patch, updatedAt: Date.now() }, { merge: true });
  return ref.id;
}
// ------------------------------------

export default async function handler(req, res) {
  // 1) Only POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 2) Verify Stripe signature
  let event;
  try {
    const raw = await getRawBody(req);
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 3) Handle events and write to Firestore
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object; // Stripe.Checkout.Session

        // You should pass userId and priceId in your Checkout session metadata if possible
        const uid = s.metadata?.userId || null;
        const email = s.customer_details?.email || s.customer_email || null;

        const patch = {
          email: email || null,
          stripeCustomerId: s.customer || null,
          subscription: {
            status: "active",          // first invoice paid
            priceId: s?.metadata?.priceId || null,
            current_period_end: null,  // we’ll fill this on subscription.updated
          },
        };

        if (uid) {
          await upsertByUid(uid, patch);
        } else if (email) {
          await upsertByEmail(email, patch);
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

        const uid = sub.metadata?.userId || null;

        const patch = {
          stripeCustomerId: customerId,
          subscription: { status, priceId, current_period_end },
        };

        if (uid) {
          await upsertByUid(uid, patch);
        } else {
          // fallback: look up customer to get email, then upsert by email
          try {
            const customer = await stripe.customers.retrieve(customerId);
            const email = customer?.email || null;
            if (email) await upsertByEmail(email, { email, ...patch });
          } catch (e) {
            console.error("⚠️ could not retrieve customer for email:", e.message);
          }
        }

        console.log(`✅ ${event.type} saved`);
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



