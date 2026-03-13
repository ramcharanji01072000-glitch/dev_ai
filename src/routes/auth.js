import express from "express";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import { User } from "../models/index.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/register",
  authLimiter,
  [
    body("username").trim().isLength({ min: 3, max: 20 }).isAlphanumeric().withMessage("Username: 3-20 alphanumeric chars"),
    body("email").isEmail().normalizeEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Password min 6 chars"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { username, email, password } = req.body;

      const existing = await User.findOne({ $or: [{ email }, { username }] });
      if (existing) return res.status(409).json({ error: "Username or email already taken" });

      const user  = await User.create({ username, email, password });
      const token = signToken(user);

      return res.status(201).json({
        token,
        user: { id: user._id, username: user.username, email: user.email, credits: 0 },
      });
    } catch (err) {
      logger.error(`Register: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }
);

router.post("/login",
  authLimiter,
  [
    body("email").isEmail().normalizeEmail(),
    body("password").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = signToken(user);
      return res.json({
        token,
        user: { id: user._id, username: user.username, email: user.email, credits: user.credits },
      });
    } catch (err) {
      logger.error(`Login: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  }
);

function signToken(user) {
  return jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

export default router;
