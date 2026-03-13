import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  username:  { type: String, unique: true, required: true, lowercase: true, trim: true },
  email:     { type: String, unique: true, required: true, lowercase: true, trim: true },
  password:  { type: String, required: true, minlength: 6 },

  // Credits
  credits:        { type: Number, default: 0, min: 0 },

  // Daily free limits (reset each day)
  dailyMessages:  { type: Number, default: 0 },
  dailyImages:    { type: Number, default: 0 },
  lastResetDate:  { type: String, default: "" },

  // Account status
  isActive:   { type: Boolean, default: true },
  createdAt:  { type: Date,    default: Date.now },
  lastSeen:   { type: Date,    default: Date.now },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
});

// Hash password before save
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Reset daily counts if new day
userSchema.methods.resetIfNewDay = function () {
  const today = new Date().toISOString().split("T")[0];
  if (this.lastResetDate !== today) {
    this.dailyMessages = 0;
    this.dailyImages   = 0;
    this.lastResetDate = today;
  }
};

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });

export default mongoose.model("User", userSchema);
