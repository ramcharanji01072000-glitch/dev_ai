import User from "../models/User.js";
import { UserPayment, Transaction } from "../models/index.js";
import { PACKAGES, AUTO_DEBIT_THRESHOLD } from "../config/packages.js";
import { createPayPalOrder, capturePayPalOrder } from "./paypal.js";
import { createRazorpayOrder } from "./razorpay.js";
import { logger } from "../utils/logger.js";

/**
 * Called after every message. Emits a popup if credits below threshold.
 */
export async function checkAndTriggerAutoDebit(username, io) {
  try {
    const user = await User.findOne({ username }).lean();
    if (!user || user.credits >= AUTO_DEBIT_THRESHOLD) return;

    const payment = await UserPayment.findOne({ username });
    if (!payment?.autoDebitEnabled) return;

    // Cooldown check — prevent popup spam
    if (payment.lastAutoDebitAt) {
      const elapsed = Date.now() - new Date(payment.lastAutoDebitAt).getTime();
      if (elapsed < (payment.autoDebitCooldownMs || 60000)) return;
    }

    const pkg = PACKAGES[payment.defaultPackageId];
    if (!pkg) return;

    // Emit confirm popup to the user's personal room
    io.to(`user:${username}`).emit("auto_debit_confirm", {
      packageId:    pkg.id,
      packageLabel: pkg.label,
      credits:      pkg.credits,
      priceUSD:     pkg.priceUSD,
      priceINR:     pkg.priceINR,
      provider:     payment.preferredProvider,
      currentCredits: user.credits,
    });

    logger.info(`Auto-debit popup sent to ${username}`);
  } catch (err) {
    logger.error(`checkAndTriggerAutoDebit error: ${err.message}`);
  }
}

/**
 * Called when user confirms the popup.
 * Returns { success, creditsAdded?, error? }
 */
export async function executeAutoDebit(username, packageId, provider) {
  const pkg     = PACKAGES[packageId];
  const payment = await UserPayment.findOne({ username });
  if (!pkg || !payment) return { success: false, error: "Invalid config" };

  try {
    if (provider === "paypal") {
      const order   = await createPayPalOrder(pkg);
      const capture = await capturePayPalOrder(order.id);

      if (capture.status !== "COMPLETED") {
        return { success: false, error: "PayPal capture failed" };
      }

      await creditUser(username, pkg, "paypal", { paypalOrderId: order.id });
      await updateLastDebit(payment);
      return { success: true, creditsAdded: pkg.credits };

    } else if (provider === "razorpay") {
      // Razorpay auto-debit: create order, frontend handles SDK
      // Actual credit happens via webhook after payment
      const order = await createRazorpayOrder(pkg);
      await Transaction.create({
        username, packageId,
        credits:          pkg.credits,
        amountINR:        pkg.priceINR,
        provider:         "razorpay",
        razorpayOrderId:  order.id,
        status:           "pending",
        isAutoDebit:      true,
      });
      return { success: true, pendingOrderId: order.id, requiresSDK: true };
    }
  } catch (err) {
    logger.error(`executeAutoDebit error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

export async function creditUser(username, pkg, provider, ids = {}) {
  await User.findOneAndUpdate(
    { username },
    { $inc: { credits: pkg.credits } }
  );

  await Transaction.create({
    username,
    packageId:  pkg.id,
    credits:    pkg.credits,
    amountUSD:  pkg.priceUSD,
    amountINR:  pkg.priceINR,
    provider,
    status:     "completed",
    ...ids,
  });
}

async function updateLastDebit(payment) {
  payment.lastAutoDebitAt = new Date();
  await payment.save();
}
