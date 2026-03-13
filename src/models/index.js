import mongoose from "mongoose";
import bcrypt from "bcryptjs";

// ─── User ──────────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:      { type: String, required: true },
  credits:       { type: Number, default: 0 },
  dailyMessages: { type: Number, default: 0 },
  dailyImages:   { type: Number, default: 0 },
  lastResetDate: { type: String, default: "" },
  isActive:      { type: Boolean, default: true },
  lastSeen:      { type: Date,    default: Date.now },
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.resetIfNewDay = function () {
  const today = new Date().toISOString().split("T")[0];
  if (this.lastResetDate !== today) {
    this.dailyMessages = 0;
    this.dailyImages   = 0;
    this.lastResetDate = today;
  }
};

// ─── Chat (private per user — like ChatGPT conversations) ─────────────────────
// Each chat belongs to one user. No other user can access it.
const chatSchema = new mongoose.Schema({
  chatId:      { type: String, required: true, unique: true },
  owner:       { type: String, required: true },   // username — strict ownership
  topic:       { type: String, default: "New Chat" },
  topicSet:    { type: Boolean, default: false },   // has AI set topic yet?
  preview:     { type: String, default: "" },       // last message snippet
  msgCount:    { type: Number, default: 0 },
  isDeleted:   { type: Boolean, default: false },
}, { timestamps: true });

chatSchema.index({ owner: 1, updatedAt: -1 });
chatSchema.index({ chatId: 1, owner: 1 }); // compound for privacy queries

// ─── Message ───────────────────────────────────────────────────────────────────
// owner field on every message — extra privacy layer
const messageSchema = new mongoose.Schema({
  chatId:   { type: String, required: true },
  owner:    { type: String, required: true },   // same as chat owner
  role:     { type: String, enum: ["user", "assistant"], required: true },
  text:     { type: String, default: "" },
  imageUrl: { type: String, default: null },
}, { timestamps: true });

messageSchema.index({ chatId: 1, owner: 1, createdAt: 1 });

// ─── Transaction ───────────────────────────────────────────────────────────────
const transactionSchema = new mongoose.Schema({
  username:          { type: String, required: true },
  packageId:         { type: String, required: true },
  credits:           { type: Number, required: true },
  amountUSD:         Number,
  amountINR:         Number,
  provider:          { type: String, enum: ["paypal", "razorpay"] },
  paypalOrderId:     String,
  razorpayOrderId:   String,
  razorpayPaymentId: String,
  status:            { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
  isAutoDebit:       { type: Boolean, default: false },
}, { timestamps: true });

transactionSchema.index({ username: 1, createdAt: -1 });

// ─── UserPayment ───────────────────────────────────────────────────────────────
const userPaymentSchema = new mongoose.Schema({
  username:           { type: String, unique: true, required: true },
  autoDebitEnabled:   { type: Boolean, default: false },
  defaultPackageId:   { type: String,  default: "starter" },
  preferredProvider:  { type: String,  enum: ["paypal", "razorpay"], default: "paypal" },
  paypal:   { billingToken: String, email: String },
  razorpay: { customerId: String,   email: String },
  lastAutoDebitAt:    Date,
}, { timestamps: true });

export const User        = mongoose.model("User",        userSchema);
export const Chat        = mongoose.model("Chat",        chatSchema);
export const Message     = mongoose.model("Message",     messageSchema);
export const Transaction = mongoose.model("Transaction", transactionSchema);
export const UserPayment = mongoose.model("UserPayment", userPaymentSchema);
