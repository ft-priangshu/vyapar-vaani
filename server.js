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
  assignedTo: { type: String, default: "UNASSIGNED" },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);

const notificationSchema = new mongoose.Schema({
  sellerId: String,
  message: String,
  type: String,
  createdAt: { type: Date, default: Date.now }
});

const Notification = mongoose.model("Notification", notificationSchema);

// ─── PRICE ENGINE ─────────────────────────────
function getPrice(name = "") {
  name = name.toLowerCase();
  if (name.includes("potato")) return "₹20/kg";
  if (name.includes("rice")) return "₹50/kg";
  if (name.includes("wheat")) return "₹35/kg";
  return "₹100 (estimate)";
}

// ─── SAFE JSON PARSE ─────────────────────────────
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  }
}

// ─── GEMINI EXTRACTOR (FIXED STABILITY) ─────────────────────────────
async function extractItems(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
Extract products from:
"${message}"

Return JSON array:
[
  { "name": "product", "quantity": "2 kg" }
]

Rules:
- always extract numbers
- if sentence form still extract
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return safeParse(text);
  } catch (e) {
    return [{ name: message, quantity: "1 unit" }];
  }
}

// ─── CHAT (STEP 1) ─────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { sellerId, message } = req.body;

    if (!sellerId || !message)
      return res.status(400).json({ error: "sellerId + message required" });

    const items = await extractItems(message);

    const enriched = items.map(i => ({
      name: i.name,
      quantity: i.quantity,
      suggestedPrice: getPrice(i.name)
    }));

    const tempId = Date.now().toString();

    global.pending = global.pending || {};
    global.pending[tempId] = { sellerId, items: enriched };

    res.json({
      message: "Confirm to list product",
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

    const data = global.pending?.[tempId];

    if (!data)
      return res.status(400).json({ error: "session expired" });

    delete global.pending[tempId];

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
      message: "OK getting listed",
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

// ─── BUY (LOGISTICS READY) ─────────────────────────────
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