import { User } from "../models/index.js";
import { FREE_LIMITS, COSTS } from "../config/packages.js";

export async function checkCredits(username, isImage = false) {
  const user = await User.findOne({ username });
  if (!user) return { allowed: false, reason: "user_not_found" };

  user.resetIfNewDay();

  // Free tier
  if (isImage) {
    if (user.dailyImages < FREE_LIMITS.imagesPerDay) {
      user.dailyImages++;
      await user.save();
      return { allowed: true, usedFree: true, remaining: user.credits };
    }
  } else {
    if (user.dailyMessages < FREE_LIMITS.messagesPerDay) {
      user.dailyMessages++;
      await user.save();
      return { allowed: true, usedFree: true, remaining: user.credits };
    }
  }

  // Paid credits
  const cost = isImage ? COSTS.imageMessage : COSTS.textMessage;
  if (user.credits >= cost) {
    user.credits -= cost;
    await user.save();
    return { allowed: true, usedFree: false, creditsUsed: cost, remaining: user.credits };
  }

  return { allowed: false, reason: isImage ? "no_image_credits" : "no_credits", remaining: user.credits };
}
