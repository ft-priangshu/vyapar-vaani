const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

app.use(cors());
app.use(bodyParser.json());

// ─── ENV CHECK ─────────────────────────────
console.log("MONGO_URI =", process.env.MONGO_URI);
console.log("GEMINI KEY EXISTS =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI INIT ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── DB CONNECT (SAFE) ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ─── PRODUCT SCHEMA ─────────────────────────────
const productSchema = new mongoose.Schema({
  items: [
    {
      name: String,
      quantity: String,
      suggestedPrice: String,
      imageUrl: String,
    },
  ],
  status: {
    type: String,
    default: "PENDING_IMAGES",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Product = mongoose.model("Product", productSchema);

// ─── ORDER SCHEMA ─────────────────────────────
const orderSchema = new mongoose.Schema({
  productId: String,
  buyerName: String,
  phone: String,
  address: String,
  status: {
    type: String,
    default: "ORDER_PLACED",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Order = mongoose.model("Order", orderSchema);

// ─── PRICE LOGIC ─────────────────────────────
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

// ─── AI FUNCTION ─────────────────────────────
async function extractItems(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });

    const prompt = `
Extract products from this message.

Return ONLY JSON:
{
  "items": [
    {
      "name": "product name",
      "quantity": "number + unit"
    }
  ]
}

Message: ${message}
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const parsed = JSON.parse(text);

    return parsed;
  } catch (err) {
    console.log("AI fallback used");

    return {
      items: [
        {
          name: message,
          quantity: "1 unit",
        },
      ],
    };
  }
}

// ─── ROUTES ─────────────────────────────

// HOME
app.get("/", (req, res) => {
  res.send("🚀 Backend Running");
});

// CHAT (MAIN AI + SAVE PRODUCT)
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const ai = await extractItems(message);

    const items = ai.items.map((item) => {
      const name = cleanName(item.name);

      return {
        name,
        quantity: item.quantity,
        suggestedPrice: suggestMarketPrice(name),
        imageUrl: null,
      };
    });

    const product = new Product({ items });
    await product.save();

    return res.json({
      message: "AI processed successfully",
      productId: product._id,
      items,
      nextStep: "UPLOAD_IMAGES",
    });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET PRODUCTS (MARKETPLACE)
app.get("/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: "Cannot fetch products" });
  }
});

// BUY (LOGISTICS DATA)
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, phone, address } = req.body;

    if (!productId || !buyerName || !phone || !address) {
      return res.status(400).json({ error: "Missing details" });
    }

    const order = new Order({
      productId,
      buyerName,
      phone,
      address,
    });

    await order.save();

    res.json({
      message: "Order placed successfully",
      orderId: order._id,
    });
  } catch (err) {
    res.status(500).json({ error: "Buy failed" });
  }
});

// ORDERS (LOGISTICS VIEW)
app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

// UPDATE ORDER STATUS
app.post("/update-status", async (req, res) => {
  const { orderId, status } = req.body;

  const updated = await Order.findByIdAndUpdate(
    orderId,
    { status },
    { new: true }
  );

  res.json({ message: "Updated", order: updated });
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});