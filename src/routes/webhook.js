import express from "express";
import { verifyWebhookSignature } from "../services/razorpay.js";
import { PACKAGES } from "../config/packages.js";
import User from "../models/User.js";
import { Transaction } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// ── Razorpay Webhook ──────────────────────────────────────────────────────────
router.post("/razorpay", async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const isValid   = verifyWebhookSignature(req.body, signature);

    if (!isValid) {
      logger.warn("Invalid Razorpay webhook signature");
      return res.status(400).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(req.body.toString());
    logger.info(`Razorpay webhook: ${event.event}`);

    if (event.event === "payment.captured") {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;

      const tx = await Transaction.findOneAndUpdate(
        { razorpayOrderId: orderId, status: "pending" },
        { status: "completed", razorpayPaymentId: payment.id },
        { new: true }
      );

      if (tx) {
        await User.findOneAndUpdate(
          { username: tx.username },
          { $inc: { credits: tx.credits } }
        );
        logger.info(`Razorpay: credited ${tx.credits} to ${tx.username}`);
      }
    }

    if (event.event === "payment.failed") {
      const orderId = event.payload.payment.entity.order_id;
      await Transaction.findOneAndUpdate(
        { razorpayOrderId: orderId },
        { status: "failed" }
      );
    }

    res.json({ status: "ok" });
  } catch (err) {
    logger.error(`Razorpay webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── PayPal Webhook ────────────────────────────────────────────────────────────
router.post("/paypal", async (req, res) => {
  try {
    const event = JSON.parse(req.body.toString());
    logger.info(`PayPal webhook: ${event.event_type}`);

    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      const orderId = event.resource.id;
      const tx = await Transaction.findOne({ paypalOrderId: orderId, status: "pending" });
      if (tx) {
        // Will be finalized by capture-order endpoint
        logger.info(`PayPal order approved: ${orderId}`);
      }
    }

    res.json({ status: "ok" });
  } catch (err) {
    logger.error(`PayPal webhook error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

export default router;
