// =============================
//        server.js
// =============================

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ─── ENV CHECK ───────────────────────────────────────────────
console.log("MONGO_URI =", process.env.MONGO_URI);

// ─── GEMINI SETUP ─────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── MongoDB Connection ───────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// ─── SAFE JSON PARSER ─────────────────────────────────────────
function safeJSONParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const cleaned = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  }
}

// ─── MODEL ────────────────────────────────────────────────────
const productSchema = new mongoose.Schema({
  name: String,
  quantity: String,
  price: String,
  suggestedPrice: String,
});

const Product = mongoose.model("Product", productSchema);

const orderSchema = new mongoose.Schema({
  productId: String,
  buyerName: String,
  address: String,
  status: String,
});

const Order = mongoose.model("Order", orderSchema);

// ─── MARKET PRICE LOGIC ───────────────────────────────────────
function suggestMarketPrice(productName) {
  const name = productName.toLowerCase();

  if (name.includes("rice")) return "₹50 per kg";
  if (name.includes("wheat")) return "₹35 per kg";
  if (name.includes("potato")) return "₹20 per kg";
  if (name.includes("onion")) return "₹30 per kg";
  if (name.includes("tomato")) return "₹40 per kg";
  if (name.includes("milk")) return "₹55 per litre";
  if (name.includes("sugar")) return "₹45 per kg";
  if (name.includes("oil")) return "₹150 per litre";
  if (name.includes("flour")) return "₹40 per kg";
  if (name.includes("egg")) return "₹7 per piece";

  return "₹100 (estimated market price)";
}

// ─── GEMINI AI FUNCTION ───────────────────────────────────────
async function extractProductInfo(message) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
  });

  const prompt = `
You are an AI for a marketplace.

Extract items from the message.

Return ONLY valid JSON:

{
  "items": [
    {
      "name": "string",
      "quantity": "string"
    }
  ]
}

Rules:
- Detect multiple items
- If quantity missing → "1 unit"
- Output ONLY JSON (no explanation)

Message: ${message}
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  return safeJSONParse(text);
}

// ─── ROUTES ───────────────────────────────────────────────────

// ROOT
app.get("/", (req, res) => {
  res.send("🚀 Vyapar Vaani Backend is running");
});

// CHAT (FIXED)
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const aiResult = await extractProductInfo(message);

    const itemsWithPrices = aiResult.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      suggestedPrice: suggestMarketPrice(item.name),
    }));

    const newProduct = new Product({
      name: itemsWithPrices[0]?.name || "Unknown",
      quantity: itemsWithPrices[0]?.quantity || "1 unit",
      price: "Not set",
      suggestedPrice: itemsWithPrices[0]?.suggestedPrice || "₹100",
    });

    await newProduct.save();

    res.json({
      message: "AI extracted items successfully",
      items: itemsWithPrices,
      productId: newProduct._id,
      nextStep: "UPLOAD_IMAGES",
    });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// PRODUCTS
app.get("/products", async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// BUY
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, address } = req.body;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const order = new Order({
      productId,
      buyerName,
      address,
      status: "Order Placed",
    });

    await order.save();

    res.json({
      message: "Order placed successfully!",
      order,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not place order" });
  }
});

// ORDERS
app.get("/orders", async (req, res) => {
  const orders = await Order.find();
  res.json(orders);
});

// UPDATE STATUS
app.post("/update-status", async (req, res) => {
  try {
    const { orderId, status } = req.body;

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true }
    );

    res.json({
      message: "Order status updated!",
      order: updatedOrder,
    });
  } catch (err) {
    res.status(500).json({ error: "Could not update order status" });
  }
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(3000, () => {
  console.log("🚀 Server is running on http://localhost:3000");
});