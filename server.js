require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { Client, GatewayIntentBits } = require("discord.js");

const app = express();

app.use(express.json());
app.use(express.static("public"));

// 🔥 FIX FOR RAILWAY ROOT
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));

/* ================= MODELS ================= */

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
  createdAt: { type: Date, default: Date.now }
});

const clipSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  username: String,
  videoUrl: String,
  likes: { type: Number, default: 0 },
  likedBy: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Clip = mongoose.model("Clip", clipSchema);

/* ================= CLOUDINARY ================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ================= DISCORD BOT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("clientReady", () => {
  console.log(`Discord Bot Online: ${client.user.tag}`);
});

client.login(process.env.TOKEN);

/* ================= AUTH ================= */

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;

  const hashed = await bcrypt.hash(password, 10);

  try {
    await User.create({ username, password: hashed });
    res.json({ message: "User created" });
  } catch {
    res.status(400).json({ error: "Username already exists" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: "Invalid login" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid login" });

  const token = jwt.sign(
    { id: user._id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

/* ================= AUTH MIDDLEWARE ================= */

function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

/* ================= UPLOAD ================= */

const upload = multer({ storage: multer.memoryStorage() });

app.post("/api/upload", auth, upload.single("video"), async (req, res) => {
  try {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "video", folder: "cs2_highlights" },
      async (error, uploadResult) => {

        if (error) return res.status(500).json({ error: "Upload failed" });

        await Clip.create({
          userId: req.user.id,
          username: req.user.username,
          videoUrl: uploadResult.secure_url
        });

        // Discord notification
        const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        channel.send(`🎬 Nytt klipp uppladdat av ${req.user.username}!`);

        res.json({ message: "Upload successful" });
      }
    );

    stream.end(req.file.buffer);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Upload error" });
  }
});

/* ================= GET CLIPS ================= */

app.get("/api/clips", async (req, res) => {
  const clips = await Clip.find().sort({ likes: -1 });
  res.json(clips);
});

app.get("/api/profile/:username", async (req, res) => {
  const clips = await Clip.find({ username: req.params.username });
  res.json(clips);
});

/* ================= LIKE ================= */

app.post("/api/like/:id", auth, async (req, res) => {
  const clip = await Clip.findById(req.params.id);
  if (!clip) return res.status(404).json({ error: "Not found" });

  if (clip.likedBy.includes(req.user.username))
    return res.json({ likes: clip.likes });

  clip.likes += 1;
  clip.likedBy.push(req.user.username);
  await clip.save();

  res.json({ likes: clip.likes });
});

/* ================= SERVER ================= */

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
