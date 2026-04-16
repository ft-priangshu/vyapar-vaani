const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

// ─── Middleware ─────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ─── ENV ─────────────────────────────
console.log("MONGO_URI =", process.env.MONGO_URI);

// ─── GEMINI SETUP ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── MONGODB CONNECT ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ─── SAFE JSON PARSER ─────────────────────────────
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

// ─── PRODUCT SCHEMA (UPDATED) ─────────────────────────────
const productSchema = new mongoose.Schema({
  items: [
    {
      name: String,
      quantity: String,
      suggestedPrice: String,
      imageUrl: String
    }
  ],
  status: {
    type: String,
    default: "PENDING_IMAGES"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Product = mongoose.model("Product", productSchema);

// ─── ORDER SCHEMA ─────────────────────────────
const orderSchema = new mongoose.Schema({
  productId: String,
  buyerName: String,
  address: String,
  status: String
});

const Order = mongoose.model("Order", orderSchema);

// ─── MARKET PRICE LOGIC ─────────────────────────────
function suggestMarketPrice(name) {
  name = name.toLowerCase();

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

// ─── GEMINI AI FUNCTION ─────────────────────────────
async function extractProductInfo(message) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash"
  });

  const prompt = `
You are a marketplace AI.

Extract products from message.

Return ONLY JSON:
{
  "items": [
    {
      "name": "string",
      "quantity": "string"
    }
  ]
}

Rules:
- detect multiple items
- default quantity = "1 unit"
- NO explanation
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  return safeJSONParse(text);
}

// ─── ROUTES ─────────────────────────────

// HOME
app.get("/", (req, res) => {
  res.send("🚀 Backend Running");
});

// CHAT (MAIN AI ROUTE)
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const aiResult = await extractProductInfo(message);

    const itemsWithPrices = aiResult.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      suggestedPrice: suggestMarketPrice(item.name),
      imageUrl: null
    }));

    const product = new Product({
      items: itemsWithPrices
    });

    await product.save();

    res.json({
      message: "AI processed successfully",
      items: itemsWithPrices,
      productId: product._id,
      nextStep: "UPLOAD_IMAGES"
    });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET PRODUCTS
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
      return res.status(404).json({ error: "Not found" });
    }

    const order = new Order({
      productId,
      buyerName,
      address,
      status: "PLACED"
    });

    await order.save();

    res.json({
      message: "Order placed",
      order
    });

  } catch (err) {
    res.status(500).json({ error: "Buy error" });
  }
});

// ORDERS
app.get("/orders", async (req, res) => {
  const orders = await Order.find();
  res.json(orders);
});

// UPDATE ORDER
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
app.post("/upload-image", async (req, res) => {
  try {
    const { productId, itemIndex, imageUrl } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    product.items[itemIndex].imageUrl = imageUrl;

    // If all images uploaded → mark LIVE
    const allUploaded = product.items.every(i => i.imageUrl);

    if (allUploaded) {
      product.status = "LIVE";
    }

    await product.save();

    res.json({
      message: "Image uploaded successfully",
      product
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── START SERVER ─────────────────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});