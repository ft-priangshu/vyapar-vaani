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
console.log("GEMINI =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── DB ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log(err));

// ─── TEMP SELL STORAGE ─────────────────────────────
const pendingSales = new Map();

// ─── PRODUCT MODEL ─────────────────────────────
const productSchema = new mongoose.Schema({
  name: String,
  quantity: String,
  price: String,
  suggestedPrice: String,
  imageUrl: String,
  status: { type: String, default: "LIVE" },
  createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model("Product", productSchema);

// ─── ORDER MODEL (LOGISTICS READY) ─────────────────────────────
const orderSchema = new mongoose.Schema({
  productId: String,
  productName: String,
  quantity: String,
  buyerName: String,
  phone: String,
  address: String,
  status: { type: String, default: "PLACED" },
  assignedTo: { type: String, default: "UNASSIGNED" },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);

// ─── PRICE ENGINE ─────────────────────────────
function getPrice(name) {
  name = (name || "").toLowerCase();

  if (name.includes("potato")) return "₹20/kg";
  if (name.includes("onion")) return "₹30/kg";
  if (name.includes("rice")) return "₹50/kg";
  if (name.includes("wheat")) return "₹35/kg";
  if (name.includes("tomato")) return "₹40/kg";
  if (name.includes("milk")) return "₹55/L";

  return "₹100 (estimate)";
}

// ─── CLEAN NAME ─────────────────────────────
function cleanName(name) {
  if (!name) return "unknown";

  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(kg|g|gram|grams|litre|liter|l|pcs|piece|pieces)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── STRONG AI PARSER (FIXED QUANTITY) ─────────────────────────────
async function extract(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
Extract product info STRICTLY.

Message: ${message}

Return JSON:
{
  "name": "product",
  "quantity": "number + unit"
}

Rules:
- if "2 kg potato" → name: potato, quantity: 2 kg
- if sentence form → still extract correctly
- NEVER ignore numbers
`;

    const result = await model.generateContent(prompt);
    let text = result.response.text();

    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const data = JSON.parse(text);

    return {
      name: cleanName(data.name),
      quantity: data.quantity || "1 unit"
    };
  } catch (e) {
    return {
      name: cleanName(message),
      quantity: "1 unit"
    };
  }
}

// ─── CHAT (STEP 1 - ASK PRICE APPROVAL) ─────────────────────────────
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    const data = await extract(message);

    const suggestedPrice = getPrice(data.name);

    const tempId = Date.now().toString();

    pendingSales.set(tempId, {
      name: data.name,
      quantity: data.quantity,
      suggestedPrice
    });

    res.json({
      message: "Do you want to sell at this price?",
      tempId,
      product: {
        name: data.name,
        quantity: data.quantity,
        suggestedPrice
      },
      nextStep: "CONFIRMATION_REQUIRED"
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── CONFIRM SELL (FIXED MARKETPLACE ISSUE) ─────────────────────────────
app.post("/confirm-sell", async (req, res) => {
  try {
    const { tempId, confirm } = req.body;

    if (!pendingSales.has(tempId)) {
      return res.status(400).json({ error: "Session expired" });
    }

    const data = pendingSales.get(tempId);

    // ❌ CANCEL
    if (!confirm) {
      pendingSales.delete(tempId);
      return res.json({ message: "Sale cancelled" });
    }

    // ✔ CONFIRM → SAVE PRODUCT (FIXED MARKETPLACE ISSUE)
    const product = new Product({
      name: data.name,
      quantity: data.quantity,
      suggestedPrice: data.suggestedPrice,
      status: "LIVE"
    });

    await product.save();
    pendingSales.delete(tempId);

    return res.json({
      message: "OK, product is getting listed on marketplace",
      product
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Confirm error" });
  }
});

// ─── MARKETPLACE ─────────────────────────────
app.get("/products", async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.json(products);
});

// ─── BUY (LOGISTICS SYSTEM FIXED) ─────────────────────────────
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, phone, address } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const order = new Order({
      productId,
      productName: product.name,
      quantity: product.quantity,
      buyerName,
      phone,
      address,
      status: "PLACED",
      assignedTo: "PENDING_ADMIN"
    });

    await order.save();

    res.json({
      message: "Order placed successfully",
      order
    });

  } catch (err) {
    res.status(500).json({ error: "Buy failed" });
  }
});

// ─── LOGISTICS DASHBOARD (ADMIN USE) ─────────────────────────────
app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

// ─── ADMIN ASSIGNMENT ─────────────────────────────
app.post("/assign-order", async (req, res) => {
  const { orderId, employee } = req.body;

  const order = await Order.findByIdAndUpdate(
    orderId,
    { assignedTo: employee, status: "ASSIGNED" },
    { new: true }
  );

  res.json({
    message: "Order assigned",
    order
  });
});

// ─── STATUS UPDATE (SENT TO SELLER CHAT) ─────────────────────────────
app.post("/update-status", async (req, res) => {
  const { orderId, status } = req.body;

  const updated = await Order.findByIdAndUpdate(
    orderId,
    { status },
    { new: true }
  );

  res.json({
    message: "Status updated",
    order: updated
  });
});

// ─── SERVER ─────────────────────────────
app.listen(3000, () => {
  console.log("Server running on 3000");
});