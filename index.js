require("dotenv").config();
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require("discord.js");
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const fs = require("fs");

/* ================= EXPRESS ================= */

const app = express();
app.use(express.json());

if (!fs.existsSync("./videos")) fs.mkdirSync("./videos");
app.use("/videos", express.static("videos"));

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("MongoDB error:", err));

const clipSchema = new mongoose.Schema({
  username: String,
  fileName: String,
  uploadDate: { type: Date, default: Date.now },
  likes: { type: Number, default: 0 }
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
      const fileName = Date.now() + "-" + attachment.name;
      const filePath = `./videos/${fileName}`;

      const response = await axios({
        method: "GET",
        url: attachment.url,
        responseType: "stream",
        timeout: 30000
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log("File downloaded successfully");

      await Clip.create({
        username: interaction.user.username,
        fileName
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
  const clips = await Clip.find().sort({ uploadDate: -1 });
  res.json(clips);
});

app.post("/api/like/:id", async (req, res) => {
  try {
    const clip = await Clip.findById(req.params.id);
    if (!clip) return res.status(404).json({ error: "Not found" });

    clip.likes += 1;
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
        body { font-family: Arial; background:#111; color:white; text-align:center; }
        h1 { margin-top:40px; }
        .clip { margin:40px auto; width:600px; background:#1e1e1e; padding:20px; border-radius:10px; }
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
                  <source src="/videos/\${clip.fileName}" type="video/mp4">
                </video>
                <p>👍 Likes: <span id="likes-\${clip._id}">\${clip.likes}</span></p>
                <button onclick="likeClip('\${clip._id}')">Like</button>
              </div>
            \`;
          });
        }

        async function likeClip(id) {
          const res = await fetch('/api/like/' + id, { method: 'POST' });
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
