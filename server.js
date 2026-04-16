const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ─── ENV CHECK ─────────────────────────────
console.log("MONGO_URI =", !!process.env.MONGO_URI);
console.log("GEMINI_KEY =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── DB CONNECT ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ─── SCHEMAS ─────────────────────────────
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

// ─── TEMP STORAGE ─────────────────────────────
const pending = {};

// ─── PRICE ENGINE ─────────────────────────────
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

// ─── SAFE GEMINI ROUTER ─────────────────────────────
async function routeMessage(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
Classify message into:
SELL | BUY | CHAT | QUERY

Message: "${message}"

Return ONLY JSON:
{
  "type": "SELL | BUY | CHAT | QUERY",
  "items": [
    { "name": "", "quantity": "" }
  ]
}
`;

    const result = await model.generateContent(prompt);

    const text = result?.response?.text?.() || "{}";
    const cleaned = text.replace(/```json|```/g, "").trim();

    return JSON.parse(cleaned);

  } catch (err) {
    console.error("Router error:", err);

    return {
      type: "CHAT",
      items: []
    };
  }
}

// ─── CHAT API (SAFE + STABLE) ─────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { sellerId, message } = req.body;

    if (!sellerId || !message) {
      return res.status(400).json({ error: "sellerId + message required" });
    }

    const ai = await routeMessage(message);

    const type = ai?.type || "CHAT";
    const items = Array.isArray(ai?.items) ? ai.items : [];

    // ─── NORMAL CHAT / QUERY ─────────────────────────────
    if (type !== "SELL") {
      return res.json({
        type,
        reply:
          type === "CHAT"
            ? "Got it 👍 How can I help you?"
            : "Here is the info you asked for",
        items
      });
    }

    // ─── SELL FLOW ─────────────────────────────
    const enriched = items.map(i => ({
      name: i.name || "unknown",
      quantity: i.quantity || "1 unit",
      suggestedPrice: getPrice(i.name || "")
    }));

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

// ─── CONFIRM SELL ─────────────────────────────
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

// ─── MARKETPLACE ─────────────────────────────
app.get("/products", async (req, res) => {
  const products = await Product.find({ status: "LIVE" });
  res.json(products);
});

// ─── BUY ─────────────────────────────
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

// ─── SERVER ─────────────────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});