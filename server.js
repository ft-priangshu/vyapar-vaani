// =============================
//        server.js
// =============================

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ─── MongoDB Connection ───────────────────────────────────────
const MONGO_URI = "mongodb://admin:admin123@ac-dr913z9-shard-00-00.oaditjn.mongodb.net:27017,ac-dr913z9-shard-00-01.oaditjn.mongodb.net:27017,ac-dr913z9-shard-00-02.oaditjn.mongodb.net:27017/vyapaar?ssl=true&replicaSet=atlas-oqvlma-shard-0&authSource=admin";

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ─── Models ───────────────────────────────────────────────────

// Product Model
const productSchema = new mongoose.Schema({
  name: String,
  quantity: String,
  price: String,
  suggestedPrice: String,
});
const Product = mongoose.model("Product", productSchema);

// Order Model
const orderSchema = new mongoose.Schema({
  productId: String,
  buyerName: String,
  address: String,
  status: String,
});
const Order = mongoose.model("Order", orderSchema);

// ─── Helper: Suggest a market price ──────────────────────────
function suggestMarketPrice(productName) {
  // Simple hardcoded suggestions based on keywords
  const name = productName.toLowerCase();

  if (name.includes("rice"))    return "₹50 per kg";
  if (name.includes("wheat"))   return "₹35 per kg";
  if (name.includes("potato"))  return "₹20 per kg";
  if (name.includes("onion"))   return "₹30 per kg";
  if (name.includes("tomato"))  return "₹40 per kg";
  if (name.includes("milk"))    return "₹55 per litre";
  if (name.includes("sugar"))   return "₹45 per kg";
  if (name.includes("oil"))     return "₹150 per litre";
  if (name.includes("flour"))   return "₹40 per kg";
  if (name.includes("egg"))     return "₹7 per piece";

  // Default suggestion for unknown products
  return "₹100 (estimated market price)";
}

// ─── Helper: Extract product info from message ────────────────
function extractProductInfo(message) {
  console.log("🔍 Extracting info from message:", message);

  // Try to extract product name (first meaningful word/phrase before keywords)
  const nameMatch = message.match(/(?:selling|sell|have|product[:\s]+)?\s*([a-zA-Z\s]+?)(?:\s+(?:quantity|qty|price|at|for|rs|₹|\d))/i);
  const name = nameMatch ? nameMatch[1].trim() : "Unknown Product";

  // Try to extract quantity (a number followed by kg/litre/piece/units etc.)
  const qtyMatch = message.match(/(\d+)\s*(kg|litre|liter|piece|pcs|units?|bags?|boxes?)?/i);
  const quantity = qtyMatch
    ? `${qtyMatch[1]} ${qtyMatch[2] || "units"}`.trim()
    : "1 unit";

  // Try to extract price (a number after rs/₹/price/at/for)
  const priceMatch = message.match(/(?:rs\.?|₹|price[:\s]+|at|for)\s*(\d+)/i);
  const price = priceMatch ? `₹${priceMatch[1]}` : "Not specified";

  return { name, quantity, price };
}

// ─── Routes ───────────────────────────────────────────────────

// 1. POST /chat — Extract product info, suggest price, save product
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    console.log("💬 /chat called with message:", message);

    // Extract product details from the message
    const { name, quantity, price } = extractProductInfo(message);

    // Suggest a market price
    const suggestedPrice = suggestMarketPrice(name);

    // Save the product to the database
    const newProduct = new Product({ name, quantity, price, suggestedPrice });
    await newProduct.save();

    console.log("✅ Product saved:", newProduct);

    res.json({
      message: "Product detected and saved!",
      detected: { name, quantity, price },
      suggestedPrice,
      productId: newProduct._id,
    });
  } catch (err) {
    console.error("❌ Error in /chat:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// 2. GET /products — Return all products
app.get("/products", async (req, res) => {
  try {
    console.log("📦 /products called");
    const products = await Product.find();
    res.json(products);
  } catch (err) {
    console.error("❌ Error in /products:", err);
    res.status(500).json({ error: "Could not fetch products" });
  }
});

// 3. POST /buy — Place an order
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, address } = req.body;

    if (!productId || !buyerName || !address) {
      return res.status(400).json({ error: "productId, buyerName, and address are required" });
    }

    console.log("🛒 /buy called for productId:", productId);

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    // Create and save the order
    const newOrder = new Order({
      productId,
      buyerName,
      address,
      status: "Order Placed",
    });
    await newOrder.save();

    console.log("✅ Order placed:", newOrder);

    res.json({
      message: "Order placed successfully!",
      order: newOrder,
    });
  } catch (err) {
    console.error("❌ Error in /buy:", err);
    res.status(500).json({ error: "Could not place order" });
  }
});

// 4. GET /orders — Return all orders
app.get("/orders", async (req, res) => {
  try {
    console.log("📋 /orders called");
    const orders = await Order.find();
    res.json(orders);
  } catch (err) {
    console.error("❌ Error in /orders:", err);
    res.status(500).json({ error: "Could not fetch orders" });
  }
});

// 5. POST /update-status — Update order status
app.post("/update-status", async (req, res) => {
  try {
    const { orderId, status } = req.body;

    if (!orderId || !status) {
      return res.status(400).json({ error: "orderId and status are required" });
    }

    console.log("🔄 /update-status called for orderId:", orderId);

    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { status },
      { new: true } // return the updated document
    );

    if (!updatedOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    console.log("✅ Order status updated:", updatedOrder);

    res.json({
      message: "Order status updated!",
      order: updatedOrder,
    });
  } catch (err) {
    console.error("❌ Error in /update-status:", err);
    res.status(500).json({ error: "Could not update order status" });
  }
});
app.get("/", (req, res) => {
  res.send("🚀 Vyapar Vaani Backend is running");
});

// ─── Start Server ─────────────────────────────────────────────
app.listen(3000, () => {
  console.log("🚀 Server is running on http://localhost:3000");
});
