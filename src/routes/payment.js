import express from "express";
import checkoutNodeJssdk from "@paypal/checkout-server-sdk";
import Razorpay from "razorpay";
import crypto from "crypto";
import { PACKAGES } from "../config/packages.js";
import { User, Transaction, UserPayment } from "../models/index.js";
import { authenticate } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = express.Router();
router.use(authenticate);

// ── PayPal client ─────────────────────────────────────────────────────────────
function paypalClient() {
  const Env = process.env.PAYPAL_MODE === "live"
    ? checkoutNodeJssdk.core.LiveEnvironment
    : checkoutNodeJssdk.core.SandboxEnvironment;
  return new checkoutNodeJssdk.core.PayPalHttpClient(
    new Env(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
  );
}

// ── Razorpay client ───────────────────────────────────────────────────────────
const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

// ── Packages ──────────────────────────────────────────────────────────────────
router.get("/packages", (_, res) => res.json(Object.values(PACKAGES)));

// ── Balance ───────────────────────────────────────────────────────────────────
router.get("/balance", async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.json({ credits: 0, dailyMessagesUsed: 0, dailyImagesUsed: 0 });
  user.resetIfNewDay();
  await user.save();
  res.json({ credits: user.credits, dailyMessagesUsed: user.dailyMessages, dailyImagesUsed: user.dailyImages });
});

// ── PayPal create order ───────────────────────────────────────────────────────
router.post("/paypal/create-order", async (req, res) => {
  try {
    const pkg = PACKAGES[req.body.packageId];
    if (!pkg) return res.status(400).json({ error: "Invalid package" });

    const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
    request.requestBody({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: pkg.priceUSD.toFixed(2) }, description: `${pkg.label} - ${pkg.credits} Credits` }],
    });
    const order = (await paypalClient().execute(request)).result;

    await Transaction.create({ username: req.user.username, packageId: pkg.id, credits: pkg.credits, amountUSD: pkg.priceUSD, provider: "paypal", paypalOrderId: order.id, status: "pending" });
    res.json({ orderId: order.id, approvalUrl: order.links.find(l => l.rel === "approve")?.href });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PayPal capture ────────────────────────────────────────────────────────────
router.post("/paypal/capture-order", async (req, res) => {
  try {
    const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(req.body.orderId);
    request.requestBody({});
    const capture = (await paypalClient().execute(request)).result;

    if (capture.status === "COMPLETED") {
      const tx = await Transaction.findOneAndUpdate({ paypalOrderId: req.body.orderId, status: "pending" }, { status: "completed" }, { new: true });
      if (!tx) return res.status(400).json({ error: "Transaction not found" });
      await User.findOneAndUpdate({ username: req.user.username }, { $inc: { credits: tx.credits } });
      const user = await User.findOne({ username: req.user.username });
      res.json({ success: true, creditsAdded: tx.credits, newBalance: user.credits });
    } else {
      await Transaction.findOneAndUpdate({ paypalOrderId: req.body.orderId }, { status: "failed" });
      res.status(400).json({ error: "Payment not completed" });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Razorpay create order ─────────────────────────────────────────────────────
router.post("/razorpay/create-order", async (req, res) => {
  try {
    const pkg = PACKAGES[req.body.packageId];
    if (!pkg) return res.status(400).json({ error: "Invalid package" });
    const order = await rz.orders.create({ amount: Math.round(pkg.priceINR * 100), currency: "INR", receipt: `r_${Date.now()}`, notes: { packageId: pkg.id } });
    await Transaction.create({ username: req.user.username, packageId: pkg.id, credits: pkg.credits, amountINR: pkg.priceINR, provider: "razorpay", razorpayOrderId: order.id, status: "pending" });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Razorpay verify ───────────────────────────────────────────────────────────
router.post("/razorpay/verify", async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
    if (expected !== signature) return res.status(400).json({ error: "Invalid signature" });
    const tx = await Transaction.findOneAndUpdate({ razorpayOrderId: orderId, status: "pending" }, { status: "completed", razorpayPaymentId: paymentId }, { new: true });
    if (!tx) return res.status(400).json({ error: "Transaction not found" });
    await User.findOneAndUpdate({ username: req.user.username }, { $inc: { credits: tx.credits } });
    const user = await User.findOne({ username: req.user.username });
    res.json({ success: true, creditsAdded: tx.credits, newBalance: user.credits });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-debit settings ───────────────────────────────────────────────────────
router.get("/auto-debit", async (req, res) => {
  const s = await UserPayment.findOne({ username: req.user.username });
  res.json(s || { autoDebitEnabled: false, defaultPackageId: "starter", preferredProvider: "paypal" });
});

router.put("/auto-debit", async (req, res) => {
  const s = await UserPayment.findOneAndUpdate(
    { username: req.user.username },
    { autoDebitEnabled: req.body.autoDebitEnabled, defaultPackageId: req.body.defaultPackageId, preferredProvider: req.body.preferredProvider },
    { upsert: true, new: true }
  );
  res.json(s);
});

// ── History ───────────────────────────────────────────────────────────────────
router.get("/history", async (req, res) => {
  const txs = await Transaction.find({ username: req.user.username, status: "completed" }).sort({ createdAt: -1 }).limit(30).lean();
  res.json(txs);
});

export default router;
