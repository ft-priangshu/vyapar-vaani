const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

app.use(cors());
app.use(bodyParser.json());

// ─── ENV ─────────────────────────────
console.log("MONGO_URI =", process.env.MONGO_URI);
console.log("GEMINI KEY =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── DB CONNECT ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ─── TEMP STORAGE FOR SELL CONFIRMATION ─────────────────────────────
const pendingSales = new Map();

// ─── PRODUCT MODEL ─────────────────────────────
const productSchema = new mongoose.Schema({
  name: String,
  quantity: String,
  price: String,
  suggestedPrice: String,
  imageUrl: String,
  status: {
    type: String,
    default: "LIVE"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Product = mongoose.model("Product", productSchema);

// ─── ORDER MODEL ─────────────────────────────
const orderSchema = new mongoose.Schema({
  productId: String,
  buyerName: String,
  phone: String,
  address: String,
  status: {
    type: String,
    default: "ORDER_PLACED"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Order = mongoose.model("Order", orderSchema);

// ─── PRICE ENGINE ─────────────────────────────
function suggestMarketPrice(name) {
  name = (name || "").toLowerCase();

  if (name.includes("rice")) return "₹50/kg";
  if (name.includes("wheat")) return "₹35/kg";
  if (name.includes("potato")) return "₹20/kg";
  if (name.includes("onion")) return "₹30/kg";
  if (name.includes("tomato")) return "₹40/kg";
  if (name.includes("milk")) return "₹55/L";
  if (name.includes("sugar")) return "₹45/kg";
  if (name.includes("oil")) return "₹150/L";
  if (name.includes("flour")) return "₹40/kg";
  if (name.includes("egg")) return "₹7/piece";

  return "₹100 (estimate)";
}

// ─── CLEAN TEXT HELPERS ─────────────────────────────
function cleanName(name) {
  if (!name) return "unknown";

  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(kg|g|gram|grams|litre|liter|l|pcs|piece|pieces)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── AI EXTRACTION (FIXED FOR ALL SENTENCES) ─────────────────────────────
async function extractProduct(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
Extract product name and quantity from ANY sentence.

Examples:
"I want to sell 2 kg potato"
"potato 2 kg"
"selling rice 5 kg"
"I have 3 kg onions"

Return JSON ONLY:
{
  "name": "",
  "quantity": ""
}

Message: ${message}
`;

    const result = await model.generateContent(prompt);
    let text = result.response.text();

    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    return JSON.parse(text);
  } catch (err) {
    return {
      name: message,
      quantity: "1 unit"
    };
  }
}

// ─── CHAT (STEP 1 - ASK CONFIRMATION) ─────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const ai = await extractProduct(message);

    const name = cleanName(ai.name);
    const quantity = ai.quantity;

    const suggestedPrice = suggestMarketPrice(name);

    const tempId = Date.now().toString();

    pendingSales.set(tempId, {
      name,
      quantity,
      suggestedPrice
    });

    res.json({
      message: "Do you want to sell at this price?",
      tempId,
      detected: {
        name,
        quantity
      },
      suggestedPrice,
      nextStep: "CONFIRMATION_REQUIRED"
    });

  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── CONFIRM SELL (STEP 2) ─────────────────────────────
app.post("/confirm-sell", async (req, res) => {
  try {
    const { tempId, confirm } = req.body;

    if (!pendingSales.has(tempId)) {
      return res.status(400).json({ error: "Invalid session" });
    }

    const data = pendingSales.get(tempId);

    if (!confirm) {
      pendingSales.delete(tempId);
      return res.json({ message: "Sale cancelled" });
    }

    const product = new Product({
      name: data.name,
      quantity: data.quantity,
      suggestedPrice: data.suggestedPrice,
      imageUrl: null
    });

    await product.save();

    pendingSales.delete(tempId);

    res.json({
      message: "Product listed successfully",
      product
    });

  } catch (err) {
    res.status(500).json({ error: "Confirm error" });
  }
});

// ─── GET PRODUCTS (MARKETPLACE) ─────────────────────────────
app.get("/products", async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json(products);
});

// ─── BUY (LOGISTICS READY) ─────────────────────────────
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, phone, address } = req.body;

    const order = new Order({
      productId,
      buyerName,
      phone,
      address
    });

    await order.save();

    res.json({
      message: "Order placed successfully",
      orderId: order._id
    });

  } catch (err) {
    res.status(500).json({ error: "Buy failed" });
  }
});

// ─── ORDERS ─────────────────────────────
app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

// ─── UPDATE ORDER STATUS ─────────────────────────────
app.post("/update-status", async (req, res) => {
  const { orderId, status } = req.body;

  const updated = await Order.findByIdAndUpdate(
    orderId,
    { status },
    { new: true }
  );

  res.json({
    message: "Updated",
    order: updated
  });
});

// ─── UPLOAD IMAGE (UNCHANGED BUT SAFE) ─────────────────────────────
app.post("/upload-image", async (req, res) => {
  try {
    const { productId, itemIndex, imageUrl } = req.body;

    const product = await Product.findById(productId);

    if (!product || !product.items) {
      return res.status(404).json({ error: "Product not found" });
    }

    product.items[itemIndex].imageUrl = imageUrl;

    await product.save();

    res.json({
      message: "Image uploaded",
      product
    });

  } catch (err) {
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── START SERVER ─────────────────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});