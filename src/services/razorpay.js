import Razorpay from "razorpay";
import crypto from "crypto";
import { logger } from "../utils/logger.js";

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export async function createRazorpayCustomer(username, email) {
  return await razorpay.customers.create({
    name:  username,
    email: email,
    fail_existing: "0",
  });
}

export async function createRazorpayOrder(pkg, currency = "INR") {
  const amount = currency === "INR"
    ? Math.round(pkg.priceINR * 100)
    : Math.round(pkg.priceUSD * 100);

  return await razorpay.orders.create({
    amount,
    currency,
    receipt:  `rcpt_${Date.now()}`,
    notes:    { packageId: pkg.id, credits: pkg.credits },
  });
}

export async function fetchRazorpayPayment(paymentId) {
  return await razorpay.payments.fetch(paymentId);
}

export function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  const body     = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");
  return expected === signature;
}

export function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return expected === signature;
}
