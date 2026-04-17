const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios"); // ✅ ADDED
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ───────────────── ENV ─────────────────
console.log("MONGO_URI =", !!process.env.MONGO_URI);
console.log("GEMINI_KEY =", !!process.env.GEMINI_API_KEY);

// ───────────────── GEMINI (kept but not used for extraction) ─────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ───────────────── DB ─────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ───────────────── SCHEMAS ─────────────────

// PRODUCTS
const productSchema = new mongoose.Schema({
  sellerId: String,
  name: String,
  quantity: String,
  suggestedPrice: String,
  status: { type: String, default: "LIVE" },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model("Product", productSchema);

// ORDERS
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

// NOTIFICATIONS
const notificationSchema = new mongoose.Schema({
  sellerId: String,
  orderId: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model("Notification", notificationSchema);

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

// ───────────────── SELL INTENT DETECTOR ─────────────────
function isSellIntent(message) {
  const msg = message.toLowerCase();
  return msg.includes("sell") || msg.includes("bechna") || /\d+/.test(msg);
}

// ───────────────── MANUAL EXTRACTION ─────────────────
function extractItemsManual(message) {
  const msg = message.toLowerCase().trim();
  const words = msg.split(/\s+/);

  let quantity = "1 unit";
  let name = "";

  for (let i = 0; i < words.length; i++) {
    if (!isNaN(words[i])) {
      quantity = words[i] + " unit";

      if (
        words[i + 1] &&
        ["kg", "g", "gram", "grams", "litre", "liter", "pcs", "pieces"].includes(words[i + 1])
      ) {
        quantity = words[i] + " " + words[i + 1];
      }
    } else {
      if (!name && !["sell", "i", "want", "to", "bechna", "hai"].includes(words[i])) {
        name = words[i];
      }
    }
  }

  return [{ name: name || "unknown", quantity }];
}

// ───────────────── CHAT ─────────────────
app.post("/chat", async (req, res) => {
  try {
    const { sellerId, message } = req.body;

    if (!sellerId || !message) {
      return res.status(400).json({ error: "sellerId + message required" });
    }

    const isSell = isSellIntent(message);

    if (!isSell) {
      return res.json({
        type: "CHAT",
        reply: "Got it 👍 How can I help you?",
        items: []
      });
    }

    const items = extractItemsManual(message);

    const enriched = items.map(i => ({
      name: i.name || "unknown",
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
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ───────────────── CONFIRM SELL ─────────────────
app.post("/confirm-sell", async (req, res) => {
  try {
    const { tempId, confirm } = req.body;

    if (!pending[tempId]) {
      return res.status(400).json({ error: "Session expired" });
    }

    const data = pending[tempId];
    delete pending[tempId];

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
    res.status(500).json({ error: "confirm failed" });
  }
});

// ───────────────── MARKETPLACE ─────────────────
app.get("/products", async (req, res) => {
  res.json(await Product.find({ status: "LIVE" }));
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

    res.json({ message: "Order placed successfully", order });

  } catch (err) {
    res.status(500).json({ error: "buy failed" });
  }
});

// ───────────────── GET ORDERS ─────────────────
app.get("/orders", async (req, res) => {
  res.json(await Order.find().sort({ createdAt: -1 }));
});

// ───────────────── UPDATE STATUS (UPDATED) ─────────────────
app.patch("/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    let message = "";

    if (status === "PICKUP_PLANNED") message = "Pickup Planned";
    if (status === "PICKED") message = "Picked";
    if (status === "DELIVERED") message = "Delivered";

    await Notification.create({
      sellerId: order.sellerId,
      orderId: order._id,
      message
    });

    // ✅ SEND TO EXTERNAL CHAT SYSTEM
    try {
      console.log("Sending to chat system:", message);

      await axios.post("https://chatsystemacm.lovable.app/api/messages", {
        sellerId: order.sellerId,
        orderId: order._id,
        message,
        status
      });

    } catch (e) {
      console.error("Chat forward failed:", e.message);
    }

    res.json(order);

  } catch (err) {
    res.status(500).json({ error: "status update failed" });
  }
});

// ───────────────── NOTIFICATIONS ─────────────────
app.get("/notifications/:sellerId", async (req, res) => {
  res.json(
    await Notification.find({ sellerId: req.params.sellerId }).sort({ createdAt: -1 })
  );
});

// ───────────────── SERVER ─────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});