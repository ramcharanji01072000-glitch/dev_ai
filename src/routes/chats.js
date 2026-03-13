import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Chat, Message } from "../models/index.js";
import { authenticate }  from "../middleware/auth.js";
import { logger }        from "../utils/logger.js";

const router = express.Router();
router.use(authenticate);

// ── List all chats (owner only) ───────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const chats = await Chat.find({ owner: req.user.username, isDeleted: false })
      .sort({ updatedAt: -1 })
      .limit(100)
      .select("chatId topic preview msgCount updatedAt createdAt")
      .lean();
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Create new chat ───────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const chat = await Chat.create({
      chatId: uuidv4().replace(/-/g, "").slice(0, 16),
      owner:  req.user.username,
      topic:  "New Chat",
    });
    res.status(201).json(chat);
  } catch (err) {
    logger.error(`Create chat: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Get messages (owner only) ─────────────────────────────────────────────────
router.get("/:chatId/messages", async (req, res) => {
  try {
    // Double-check ownership on both Chat AND Message
    const chat = await Chat.findOne({ chatId: req.params.chatId, owner: req.user.username, isDeleted: false });
    if (!chat) return res.status(404).json({ error: "Chat not found" });

    const { before } = req.query; // for pagination: pass oldest message _id
    const query = { chatId: chat.chatId, owner: req.user.username };
    if (before) query._id = { $lt: before };

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(messages.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rename chat ───────────────────────────────────────────────────────────────
router.put("/:chatId", async (req, res) => {
  try {
    const chat = await Chat.findOneAndUpdate(
      { chatId: req.params.chatId, owner: req.user.username },
      { topic: req.body.topic?.slice(0, 60) || "Chat" },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: "Chat not found" });
    res.json(chat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete chat (soft delete) ─────────────────────────────────────────────────
router.delete("/:chatId", async (req, res) => {
  try {
    await Chat.findOneAndUpdate(
      { chatId: req.params.chatId, owner: req.user.username },
      { isDeleted: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
