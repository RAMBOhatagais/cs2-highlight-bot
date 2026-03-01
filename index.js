require("dotenv").config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require("discord.js");
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const { v2: cloudinary } = require("cloudinary");

/* ================= CLOUDINARY ================= */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/* ================= EXPRESS ================= */

const app = express();
app.use(express.json());

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));

const clipSchema = new mongoose.Schema({
  username: String,
  videoUrl: String,
  uploadDate: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 },
  likedBy: { type: [String], default: [] }
});

const Clip = mongoose.model("Clip", clipSchema);

/* ================= DISCORD BOT ================= */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const commands = [
  new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Ladda upp CS2 klipp")
    .addAttachmentOption(option =>
      option.setName("video")
        .setDescription("Max 2 minuter")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("password")
        .setDescription("Lösenord")
        .setRequired(true))
].map(c => c.toJSON());

client.once("clientReady", async () => {
  console.log(`Bot online: ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "upload") {

    const password = interaction.options.getString("password");
    const attachment = interaction.options.getAttachment("video");

    if (password !== process.env.PASSWORD)
      return interaction.reply({ content: "Fel lösenord", ephemeral: true });

    await interaction.deferReply();

    try {

      const uploadResult = await cloudinary.uploader.upload(attachment.url, {
        resource_type: "video",
        folder: "cs2_highlights"
      });

      await Clip.create({
        username: interaction.user.username,
        videoUrl: uploadResult.secure_url
      });

      await interaction.editReply("✅ Klipp uppladdat!");
      await interaction.channel.send(`@everyone 🎬 Nytt klipp av ${interaction.user.username}!`);

    } catch (error) {
      console.error("UPLOAD ERROR:", error);
      await interaction.editReply("❌ Något gick fel vid uppladdningen.");
    }
  }
});

/* ================= API ================= */

app.get("/api/clips", async (req, res) => {
  const clips = await Clip.find().sort({ likes: -1 });
  res.json(clips);
});

app.post("/api/like/:id", async (req, res) => {
  try {
    const { user } = req.body;
    const clip = await Clip.findById(req.params.id);

    if (!clip) return res.status(404).json({ error: "Not found" });

    if (clip.likedBy.includes(user)) {
      return res.json({ likes: clip.likes });
    }

    clip.likes += 1;
    clip.likedBy.push(user);
    await clip.save();

    res.json({ likes: clip.likes });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= WEBSITE ================= */

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>CS2 Highlights</title>
      <style>
        body { font-family: Arial; background:#111; color:white; text-align:center; margin:0; padding:20px; }
        .clip { margin:30px auto; max-width:700px; background:#1e1e1e; padding:20px; border-radius:10px; }
        video { width:100%; border-radius:10px; }
        button { padding:10px 20px; background:#00ff88; border:none; cursor:pointer; border-radius:5px; margin-top:10px; }
      </style>
    </head>
    <body>
      <h1>🔥 CS2 Highlights 🔥</h1>
      <div id="clips"></div>

      <script>
        async function loadClips() {
          const res = await fetch('/api/clips');
          const clips = await res.json();
          const container = document.getElementById('clips');
          container.innerHTML = '';

          clips.forEach(clip => {
            container.innerHTML += \`
              <div class="clip">
                <h3>\${clip.username}</h3>
                <video controls>
                  <source src="\${clip.videoUrl}" type="video/mp4">
                </video>
                <p>👍 Likes: <span id="likes-\${clip._id}">\${clip.likes}</span></p>
                <button onclick="likeClip('\${clip._id}')">Like</button>
              </div>
            \`;
          });
        }

        async function likeClip(id) {
          let user = localStorage.getItem("user");
          if (!user) {
            user = prompt("Skriv ditt namn:");
            localStorage.setItem("user", user);
          }

          const res = await fetch('/api/like/' + id, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user })
          });

          const data = await res.json();
          document.getElementById('likes-' + id).innerText = data.likes;
        }

        loadClips();
      </script>
    </body>
    </html>
  `);
});

/* ================= START SERVER ================= */

app.listen(process.env.PORT || 3000, () => {
  console.log("Webserver running");
});

client.login(process.env.TOKEN);
