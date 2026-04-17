const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ───────────────── ENV ─────────────────
console.log("MONGO_URI =", !!process.env.MONGO_URI);
console.log("GEMINI_KEY =", !!process.env.GEMINI_API_KEY);

// ───────────────── GEMINI (kept, but NOT used for extraction) ─────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

// ───────────────── MEMORY ─────────────────
const pending = {};

// ───────────────── PRICE ENGINE ─────────────────
function getPrice(name = "") {
  const n = name.toLowerCase();

  if (n.includes("potato")) return "₹20/kg";
  if (n.includes("onion")) return "₹30/kg";
  if (n.includes("rice")) return "₹50/kg";
  if (n.includes("wheat")) return "₹35/kg";
  if (n.includes("tomato")) return "₹40/kg";
  if (n.includes("milk")) return "₹55/L";

  return "₹100 (estimate)";
}

// ───────────────── SELL DETECTOR ─────────────────
function isSellIntent(message) {
  const msg = message.toLowerCase();

  return (
    msg.includes("sell") ||
    msg.includes("bechna") ||
    /\d+/.test(msg) // contains number → assume selling
  );
}

// ───────────────── MANUAL ITEM EXTRACTOR (CORE FIX) ─────────────────
function extractItemsManual(message) {
  const msg = message.toLowerCase().trim();

  const words = msg.split(/\s+/);

  let quantity = "1 unit";
  let name = "";

  for (let i = 0; i < words.length; i++) {
    // detect number
    if (!isNaN(words[i])) {
      quantity = words[i] + " unit";

      if (
        words[i + 1] &&
        ["kg", "g", "gram", "grams", "litre", "liter", "pcs", "pieces"].includes(words[i + 1])
      ) {
        quantity = words[i] + " " + words[i + 1];
      }
    } else {
      // ignore filler words
      if (!name && !["sell", "i", "want", "to", "bechna", "hai"].includes(words[i])) {
        name = words[i];
      }
    }
  }

  return [
    {
      name: name || "unknown",
      quantity
    }
  ];
}

// ───────────────── CHAT API ─────────────────
app.post("/chat", async (req, res) => {
  try {
    const { sellerId, message } = req.body;

    if (!sellerId || !message) {
      return res.status(400).json({ error: "sellerId + message required" });
    }

    const isSell = isSellIntent(message);

    // ───── NORMAL CHAT ─────
    if (!isSell) {
      return res.json({
        type: "CHAT",
        reply: "Got it 👍 How can I help you?",
        items: []
      });
    }

    // ───── SELL FLOW ─────
    const items = extractItemsManual(message);

    const enriched = items.map(i => {
      const name = (i.name || "").toLowerCase().trim();
      const quantity = (i.quantity || "1 unit").trim();

      return {
        name: name || "unknown",
        quantity,
        suggestedPrice: getPrice(name)
      };
    });

    const tempId = Date.now().toString();

    global.pending = global.pending || {};
    global.pending[tempId] = {
      sellerId,
      items: enriched
    };

    return res.json({
      type: "SELL",
      message: "Do you want to sell at suggested price?",
      tempId,
      items: enriched,
      nextStep: "CONFIRM"
    });

  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────── CONFIRM SELL ─────────────────
app.post("/confirm-sell", async (req, res) => {
  try {
    const { tempId, confirm } = req.body;

    if (!global.pending?.[tempId]) {
      return res.status(400).json({ error: "Session expired" });
    }

    const data = global.pending[tempId];
    delete global.pending[tempId];

    if (!confirm) {
      return res.json({ message: "Cancelled" });
    }

    const saved = await Product.insertMany(
      data.items.map(i => ({
        sellerId: data.sellerId,
        name: i.name,
        quantity: i.quantity,
        suggestedPrice: i.suggestedPrice,
        status: "LIVE"
      }))
    );

    res.json({
      message: "OK getting listed on marketplace",
      products: saved
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "confirm failed" });
  }
});

// ───────────────── MARKETPLACE ─────────────────
app.get("/products", async (req, res) => {
  const products = await Product.find({ status: "LIVE" });
  res.json(products);
});

// ───────────────── BUY ─────────────────
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, phone, address } = req.body;

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: "Not found" });

    const order = await Order.create({
      productId,
      productName: product.name,
      quantity: product.quantity,
      sellerId: product.sellerId,
      buyerName,
      phone,
      address
    });

    res.json({
      message: "Order placed successfully",
      order
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "buy failed" });
  }
});

// ───────────────── START SERVER ─────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});