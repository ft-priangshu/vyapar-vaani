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
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

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

// ─── Helper: Extract product info from message ────────────────
function extractProductInfo(message) {
  const nameMatch = message.match(/(?:selling|sell|have|product[:\s]+)?\s*([a-zA-Z\s]+?)(?:\s+(?:quantity|qty|price|at|for|rs|₹|\d))/i);
  const name = nameMatch ? nameMatch[1].trim() : "Unknown Product";

  const qtyMatch = message.match(/(\d+)\s*(kg|litre|liter|piece|pcs|units?|bags?|boxes?)?/i);
  const quantity = qtyMatch
    ? `${qtyMatch[1]} ${qtyMatch[2] || "units"}`
    : "1 unit";

  const priceMatch = message.match(/(?:rs\.?|₹|price[:\s]+|at|for)\s*(\d+)/i);
  const price = priceMatch ? `₹${priceMatch[1]}` : "Not specified";

  return { name, quantity, price };
}

// ─── Routes ───────────────────────────────────────────────────

// Root test route
app.get("/", (req, res) => {
  res.send("🚀 Vyapar Vaani Backend is running");
});

// Chat route
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const { name, quantity, price } = extractProductInfo(message);
    const suggestedPrice = suggestMarketPrice(name);

    const newProduct = new Product({
      name,
      quantity,
      price,
      suggestedPrice,
    });

    await newProduct.save();

    res.json({
      message: "Product detected and saved!",
      detected: { name, quantity, price },
      suggestedPrice,
      productId: newProduct._id,
    });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Get products
app.get("/products", async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// Buy product
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

// Get orders
app.get("/orders", async (req, res) => {
  const orders = await Order.find();
  res.json(orders);
});

// Update order status
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

// ─── Start Server ─────────────────────────────────────────────
app.listen(3000, () => {
  console.log("🚀 Server is running on http://localhost:3000");
});