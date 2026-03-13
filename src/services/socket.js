import { authenticateSocket } from "../middleware/auth.js";
import { checkCredits }       from "../middleware/checkCredits.js";
import { generateReply, generateTopic } from "../services/gemini.js";
import { Chat, Message, User } from "../models/index.js";
import { logger }              from "../utils/logger.js";

export function initSocket(io) {
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const { username } = socket.data;
    logger.info(`Connected: ${username} [${socket.id}]`);

    // Each user gets their own private room — events only go to them
    socket.join(`u:${username}`);

    // ── Open chat ───────────────────────────────────────────────────────────────
    socket.on("open_chat", async ({ chatId }) => {
      try {
        // PRIVACY: find only if this user is the owner
        const chat = await Chat.findOne({ chatId, owner: username, isDeleted: false });
        if (!chat) {
          socket.emit("error", { message: "Chat not found" });
          return;
        }

        socket.data.chatId = chatId;

        // Load last 60 messages, only this owner's messages
        const messages = await Message.find({ chatId, owner: username })
          .sort({ createdAt: 1 })
          .limit(60)
          .lean();

        socket.emit("chat_history", messages);
      } catch (err) {
        logger.error(`open_chat: ${err.message}`);
        socket.emit("error", { message: "Failed to open chat" });
      }
    });

    // ── Send message ────────────────────────────────────────────────────────────
    socket.on("send_message", async ({ text, imageBase64, mimeType }) => {
      const { chatId } = socket.data;
      if (!chatId) {
        socket.emit("error", { message: "No chat open. Call open_chat first." });
        return;
      }

      const isImage = !!imageBase64;
      text = (text || "").trim();

      if (!text && !imageBase64) return;

      // ── Credit check ──────────────────────────────────────────────────────────
      const credit = await checkCredits(username, isImage);
      if (!credit.allowed) {
        socket.emit("credit_error", {
          reason:    credit.reason,
          remaining: credit.remaining,
          message:   isImage
            ? "Free image used. Buy credits to continue."
            : "Free messages used. Buy credits to continue.",
        });
        return;
      }

      // ── Save user message ─────────────────────────────────────────────────────
      const userMsg = await Message.create({
        chatId,
        owner:    username,
        role:     "user",
        text,
        imageUrl: imageBase64 ? `data:${mimeType};base64,${imageBase64}` : null,
      });

      socket.emit("new_message", userMsg);
      socket.emit("ai_typing", true);

      try {
        // ── Auto-name topic after first message (fire and forget) ───────────────
        const chat = await Chat.findOne({ chatId, owner: username });
        if (chat && !chat.topicSet && text) {
          // Don't await — runs in background so it doesn't slow down reply
          generateTopic(text).then(async (topic) => {
            await Chat.findOneAndUpdate(
              { chatId, owner: username },
              { topic, topicSet: true }
            );
            // Push topic update to client
            socket.emit("topic_set", { chatId, topic });
            logger.info(`Topic set for ${chatId}: "${topic}"`);
          }).catch(err => logger.error(`Topic gen failed: ${err.message}`));
        }

        // ── Fetch history for context (last 12 messages) ──────────────────────
        const history = await Message.find({ chatId, owner: username })
          .sort({ createdAt: -1 })
          .limit(12)
          .lean();

        // ── Generate AI reply ─────────────────────────────────────────────────
        const aiText = await generateReply(
          text,
          imageBase64 || null,
          mimeType    || null,
          history.reverse()
        );

        // ── Save AI message ───────────────────────────────────────────────────
        const aiMsg = await Message.create({
          chatId,
          owner: username,
          role:  "assistant",
          text:  aiText,
        });

        // Update chat preview
        await Chat.findOneAndUpdate(
          { chatId, owner: username },
          {
            preview:  aiText.slice(0, 80),
            msgCount: (chat?.msgCount || 0) + 2,
            updatedAt: new Date(),
          }
        );

        socket.emit("new_message", aiMsg);
        socket.emit("ai_typing", false);
        socket.emit("credit_update", { remaining: credit.remaining, usedFree: credit.usedFree });

      } catch (err) {
        logger.error(`Reply error: ${err.message}`);
        socket.emit("ai_typing", false);
        socket.emit("ai_error", { message: "AI failed to respond. Please retry." });
      }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      logger.info(`Disconnected: ${username}`);
      User.findOneAndUpdate({ username }, { lastSeen: new Date() }).catch(() => {});
    });
  });
}
