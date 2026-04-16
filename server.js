const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ─── ENV ─────────────────────────────
console.log("MONGO_URI =", !!process.env.MONGO_URI);
console.log("GEMINI_KEY =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── DB ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error(err));

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

// ─── TEMP MEMORY ─────────────────────────────
const pending = {};

// ─── PRICE ENGINE ─────────────────────────────
function getPrice(name = "") {
  name = name.toLowerCase();
  if (name.includes("potato")) return "₹20/kg";
  if (name.includes("onion")) return "₹30/kg";
  if (name.includes("rice")) return "₹50/kg";
  if (name.includes("wheat")) return "₹35/kg";
  return "₹100 (estimate)";
}

// ─── SAFE JSON ─────────────────────────────
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  }
}

// ─── SMART AI ROUTER (NEW CORE) ─────────────────────────────
async function routeMessage(message) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    generationConfig: { responseMimeType: "application/json" }
  });

  const prompt = `
You are a smart AI router for a marketplace app.

Classify user message into ONE type:

1. "SELL" → user wants to sell products
2. "BUY" → user wants to buy
3. "CHAT" → normal conversation
4. "QUERY" → asking price/info

Message: "${message}"

Return ONLY JSON:
{
  "type": "SELL | BUY | CHAT | QUERY",
  "items": [
    { "name": "", "quantity": "" }
  ]
}

Rules:
- If selling products → extract items
- If not selling → items = []
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  return safeParse(text);
}

// ─── CHAT ROUTE (SMART ROUTER) ─────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { sellerId, message } = req.body;

    if (!sellerId || !message)
      return res.status(400).json({ error: "sellerId + message required" });

    const ai = await routeMessage(message);

    // ─── NORMAL CHAT ─────────────────────────────
    if (ai.type !== "SELL") {
      return res.json({
        type: ai.type,
        message: "Processed by AI router",
        reply:
          ai.type === "CHAT"
            ? "Got it 👍 How can I help you with selling?"
            : "Here is the info you asked for",
        items: ai.items || []
      });
    }

    // ─── SELL FLOW ─────────────────────────────
    const enriched = (ai.items || []).map(i => ({
      name: i.name,
      quantity: i.quantity,
      suggestedPrice: getPrice(i.name)
    }));

    const tempId = Date.now().toString();
    pending[tempId] = { sellerId, items: enriched };

    return res.json({
      type: "SELL",
      message: "Do you want to sell at suggested price?",
      tempId,
      items: enriched,
      nextStep: "CONFIRM"
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// ─── CONFIRM SELL ─────────────────────────────
app.post("/confirm-sell", async (req, res) => {
  try {
    const { tempId, confirm } = req.body;

    if (!pending[tempId])
      return res.status(400).json({ error: "session expired" });

    const data = pending[tempId];
    delete pending[tempId];

    if (!confirm)
      return res.json({ message: "Cancelled" });

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
    if (!product) return res.status(404).json({ error: "not found" });

    const order = await Order.create({
      productId,
      productName: product.name,
      quantity: product.quantity,
      sellerId: product.sellerId,
      buyerName,
      phone,
      address
    });

    res.json({ message: "Order placed", order });

  } catch (err) {
    res.status(500).json({ error: "buy failed" });
  }
});

// ─── SERVER ─────────────────────────────
app.listen(3000, () => console.log("Server running"));