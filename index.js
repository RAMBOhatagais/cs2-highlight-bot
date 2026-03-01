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
  uploadDate: { type: Date, default: Date.now }
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

app.get("/", (req, res) => {
  res.send("CS2 Highlight Bot is running 🚀");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Webserver running");
});

client.login(process.env.TOKEN);
