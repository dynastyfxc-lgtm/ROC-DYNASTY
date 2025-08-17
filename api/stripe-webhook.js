// pages/api/stripe-webhook.js (Next.js API route)

import { buffer } from 'micro';
import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false, // Stripe requires raw body
  },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      console.log('✅ Checkout session completed:', event.data.object);
      break;
    case 'customer.subscription.created':
      console.log('✅ Subscription created:', event.data.object);
      break;
    case 'customer.subscription.updated':
      console.log('✅ Subscription updated:', event.data.object);
      break;
    case 'customer.subscription.deleted':
      console.log('✅ Subscription deleted:', event.data.object);
      break;
    default:
      console.log(`⚠️ Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
}



