const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const Groq = require("groq-sdk");
const multer = require("multer");
const fs = require("fs");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = file.originalname.split(".").pop();
    cb(null, Date.now() + "." + ext);
  }
});

const upload = multer({ storage });

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ───────────────── ENV ─────────────────
console.log("MONGO_URI =", !!process.env.MONGO_URI);
console.log("GROQ_KEY =", !!process.env.GROQ_API_KEY);
console.log("MANDI_KEY =", !!process.env.MANDI_API);

// ───────────────── GROQ ─────────────────
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ───────────────── DB ─────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ───────────────── SCHEMAS ─────────────────
const productSchema = new mongoose.Schema({
  sellerId: String,
  name: String,
  quantity: String,
  suggestedPrice: String,
  status: { type: String, default: "LIVE" },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model("Product", productSchema);

const orderSchema = new mongoose.Schema({
  productId: String,
  productName: String,
  quantity: String,
  sellerId: String,
  buyerName: String,
  phone: String,
  address: String,
  status: { type: String, default: "PLACED" },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model("Order", orderSchema);

const notificationSchema = new mongoose.Schema({
  sellerId: String,
  orderId: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model("Notification", notificationSchema);

// ───────────────── MEMORY ─────────────────
const pending = {};

// ───────────────── NORMALIZE TEXT (FIXED) ─────────────────
function normalizeText(text = "") {
  let clean = text
    .replace(/[\u0600-\u06FF]/g, "") // remove Urdu
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097F\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  clean = clean
    .replace(/\bpyaz\b/g, "onion")
    .replace(/प्याज/g, "onion")
    .replace(/\baloo\b/g, "potato")
    .replace(/आलू/g, "potato")
    .replace(/\baam\b/g, "mango")
    .replace(/आम/g, "mango")
    .replace(/\btamatar\b/g, "tomato")
    .replace(/टमाटर/g, "tomato")
    .replace(/\bkilograms?\b/g, "kg")
    .replace(/\bkilo\b/g, "kg")
    .replace(/किलो/g, "kg");

  return clean;
}

// ───────────────── FIX WRONG ITEM NAMES ─────────────────
function fixItemName(name, originalText) {
  const units = [
    "kg","kilogram","kilograms","gram","grams",
    "litre","l","unit","piece","pieces"
  ];

  if (units.includes(name)) {
    const words = originalText.split(" ");
    const realItem = words.find(w =>
      isNaN(w) && !units.includes(w) && w.length > 2
    );
    return realItem || "unknown";
  }

  return name;
}

// ───────────────── PRICE ENGINE ─────────────────
function getPrice(name = "") {
  const n = name.toLowerCase();

  if (n.includes("onion")) return "₹30/kg";
  if (n.includes("potato")) return "₹20/kg";
  if (n.includes("rice")) return "₹50/kg";
  if (n.includes("wheat")) return "₹35/kg";

  return "₹100 (estimate)";
}

// ───────────────── MANDI API ─────────────────
async function getLivePrice(item) {
  try {
    const API_KEY = process.env.MANDI_API;

    const url = `https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24?api-key=${API_KEY}&format=json&limit=100`;

    const res = await axios.get(url);
    const records = res.data.records || [];

    const itemClean = item.toLowerCase().trim();

    for (const r of records) {
      const nameField = (r.commodity || "").toLowerCase();
      const priceField = r.modal_price;

      if (
        itemClean &&
        (nameField.includes(itemClean) || itemClean.includes(nameField)) &&
        priceField
      ) {
        const pricePerKg = parseFloat(priceField) / 100;
        return `₹${pricePerKg.toFixed(2)}/kg`;
      }
    }

    return getPrice(item);

  } catch {
    return getPrice(item);
  }
}

// ───────────────── FALLBACK EXTRACTION ─────────────────
function extractItemsFallback(message) {
  const msg = message.toLowerCase();

  let match = msg.match(/(\d+)\s?(kg|g)?\s+([a-z]+)/);

  if (!match) {
    match = msg.match(/([a-z]+)\s+(\d+)\s?(kg|g)/);
    if (match) {
      return [{
        name: match[1],
        quantity: `${match[2]} ${match[3]}`
      }];
    }
  }

  if (match) {
    return [{
      name: match[3],
      quantity: `${match[1]} ${match[2] || "unit"}`
    }];
  }

  return [{ name: "unknown", quantity: "1 unit" }];
}

// ───────────────── GROQ AI EXTRACTION ─────────────────
async function extractItemsAI(message) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        {
          role: "system",
          content: `
Extract items with quantity.

Support English + Hindi.

Return JSON only:
[
 { "name": "onion", "quantity": "5 kg" }
]
`
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    let text = completion.choices[0].message.content.trim();
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return extractItemsFallback(message);
    }

    return parsed.map(i => ({
      name: fixItemName((i.name || "").toLowerCase(), message),
      quantity: i.quantity || "1 unit"
    }));

  } catch {
    return extractItemsFallback(message);
  }
}

// ───────────────── VOICE ROUTE (FIXED) ─────────────────
app.post("/voice", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-large-v3"
    });

    let text = transcription.text || "";

    if (!text.trim()) {
      return res.status(500).json({ error: "No speech detected" });
    }

    const cleaned = normalizeText(text);
    text = cleaned || text.toLowerCase();

    const items = await extractItemsAI(text);

    const enriched = await Promise.all(
      items.map(async i => ({
        name: i.name,
        quantity: i.quantity,
        suggestedPrice: await getLivePrice(i.name)
      }))
    );

    const tempId = Date.now().toString();
    pending[tempId] = { sellerId: req.body.sellerId, items: enriched };

    res.json({
      type: "SELL",
      message: "Voice processed successfully",
      voiceText: text,
      tempId,
      items: enriched,
      nextStep: "CONFIRM"
    });

  } catch (err) {
    res.status(500).json({ error: "Voice processing failed" });
  }
});

// ───────────────── CHAT ─────────────────
app.post("/chat", async (req, res) => {
  const { sellerId, message } = req.body;

  const items = await extractItemsAI(normalizeText(message));

  const enriched = await Promise.all(
    items.map(async i => ({
      name: i.name,
      quantity: i.quantity,
      suggestedPrice: await getLivePrice(i.name)
    }))
  );

  const tempId = Date.now().toString();
  pending[tempId] = { sellerId, items: enriched };

  res.json({
    type: "SELL",
    message: "Do you want to sell at suggested price?",
    tempId,
    items: enriched,
    nextStep: "CONFIRM"
  });
});

// ───────────────── CONFIRM ─────────────────
app.post("/confirm-sell", async (req, res) => {
  const { tempId, confirm } = req.body;

  const data = pending[tempId];
  delete pending[tempId];

  if (!confirm) return res.json({ message: "Cancelled" });

  const saved = await Product.insertMany(
    data.items.map(i => ({
      sellerId: data.sellerId,
      name: i.name,
      quantity: i.quantity,
      suggestedPrice: i.suggestedPrice
    }))
  );

  res.json({ message: "Listed", products: saved });
});

// ───────────────── SERVER ─────────────────
app.listen(3000, () => console.log("Server running"));