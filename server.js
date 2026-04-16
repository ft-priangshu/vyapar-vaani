// =============================
//        server.js
// =============================

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const app = express();

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json());
console.log("MONGO_URI =", process.env.MONGO_URI);

// ─── MongoDB Connection ───────────────────────────────────────
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err);
  }
};

connectDB();

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
- Output ONLY JSON (no text)

Message: ${message}
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  return JSON.parse(text);
}

// ─── Routes ───────────────────────────────────────────────────

// Root test route
app.get("/", (req, res) => {
  res.send("🚀 Vyapar Vaani Backend is running");
});

// Chat route
const aiResult = await extractProductInfo(message);

const itemsWithPrices = aiResult.items.map(item => ({
  name: item.name,
  quantity: item.quantity,
  suggestedPrice: suggestMarketPrice(item.name)
}));

const newProduct = new Product({
  items: itemsWithPrices
});

await newProduct.save();

res.json({
  message: "AI extracted items successfully",
  items: itemsWithPrices,
  productId: newProduct._id,
  nextStep: "UPLOAD_IMAGES"
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