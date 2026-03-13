import checkoutNodeJssdk from "@paypal/checkout-server-sdk";
import { logger } from "../utils/logger.js";

function getClient() {
  const EnvClass = process.env.PAYPAL_MODE === "live"
    ? checkoutNodeJssdk.core.LiveEnvironment
    : checkoutNodeJssdk.core.SandboxEnvironment;

  const env = new EnvClass(
    process.env.PAYPAL_CLIENT_ID,
    process.env.PAYPAL_CLIENT_SECRET
  );
  return new checkoutNodeJssdk.core.PayPalHttpClient(env);
}

export async function createPayPalOrder(pkg) {
  const request = new checkoutNodeJssdk.orders.OrdersCreateRequest();
  request.requestBody({
    intent: "CAPTURE",
    purchase_units: [{
      amount: {
        currency_code: "USD",
        value: pkg.priceUSD.toFixed(2),
      },
      description: `${pkg.label} - ${pkg.credits} AI Credits`,
    }],
    application_context: {
      brand_name:          "AI Wrapper",
      landing_page:        "BILLING",
      user_action:         "PAY_NOW",
      return_url:          "myapp://payment/success",
      cancel_url:          "myapp://payment/cancel",
    },
  });

  const response = await getClient().execute(request);
  return response.result;
}

export async function capturePayPalOrder(orderId) {
  const request = new checkoutNodeJssdk.orders.OrdersCaptureRequest(orderId);
  request.requestBody({});
  const response = await getClient().execute(request);
  return response.result;
}

export async function getPayPalOrderDetails(orderId) {
  const request = new checkoutNodeJssdk.orders.OrdersGetRequest(orderId);
  const response = await getClient().execute(request);
  return response.result;
}
