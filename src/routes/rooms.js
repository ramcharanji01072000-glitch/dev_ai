import express from "express";
import { v4 as uuidv4 } from "uuid";
import { Room, Message } from "../models/index.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();
router.use(authenticate);

// Create room
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;
    const room = await Room.create({
      roomId:    uuidv4().slice(0, 8).toUpperCase(),
      name:      name || `Room-${Date.now()}`,
      createdBy: req.user.username,
      members:   [req.user.username],
    });
    res.status(201).json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all active rooms
router.get("/", async (req, res) => {
  const rooms = await Room.find({ isActive: true })
    .sort({ createdAt: -1 }).limit(50).lean();
  res.json(rooms);
});

// Get room by ID
router.get("/:roomId", async (req, res) => {
  const room = await Room.findOne({ roomId: req.params.roomId, isActive: true });
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json(room);
});

// Get room messages (paginated)
router.get("/:roomId/messages", async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const skip = (page - 1) * limit;

  const messages = await Message.find({ roomId: req.params.roomId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit))
    .lean();

  res.json(messages.reverse());
});

// Delete room (creator only)
router.delete("/:roomId", async (req, res) => {
  const room = await Room.findOne({ roomId: req.params.roomId });
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.createdBy !== req.user.username) return res.status(403).json({ error: "Forbidden" });

  room.isActive = false;
  await room.save();
  res.json({ success: true });
});

export default router;
