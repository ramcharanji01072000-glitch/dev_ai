import express from "express";
import User from "../models/User.js";
import { Transaction } from "../models/index.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticate);

router.get("/", async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  if (!user) return res.json({ credits: 0 });
  user.resetIfNewDay();
  await user.save();
  res.json({ credits: user.credits });
});

export default router;
