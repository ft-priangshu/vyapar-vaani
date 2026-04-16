const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

// ─── MIDDLEWARE ─────────────────────────────
app.use(cors());
app.use(bodyParser.json());

// ─── ENV DEBUG ─────────────────────────────
console.log("MONGO_URI =", process.env.MONGO_URI);
console.log("GEMINI KEY EXISTS =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI SETUP ─────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── DB CONNECTION ─────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ─── SCHEMAS ─────────────────────────────
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

const orderSchema = new mongoose.Schema({
  productId: String,
  buyerName: String,
  address: String,
  status: String,
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

// ─── CLEAN NAME FUNCTION (IMPORTANT FIX) ─────────────────────────────
function cleanName(name) {
  if (!name) return "unknown";

  return name
    .toLowerCase()
    .replace(/i am selling|selling|i have|have|product|items?/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

// ─── GEMINI EXTRACTION (FIXED PROMPT) ─────────────────────────────
async function extractProductInfo(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });

    const prompt = `
You are a STRICT PRODUCT EXTRACTION ENGINE.

TASK:
Extract ONLY product names and quantities from the message.

RULES:
- DO NOT copy full sentence
- ONLY extract product names (rice, wheat, apple, etc.)
- Split multiple items properly
- If quantity missing → "1 unit"
- Return ONLY valid JSON

FORMAT:
{
  "items": [
    {
      "name": "product name only",
      "quantity": "quantity with unit"
    }
  ]
}

EXAMPLE:
Input: I am selling 2 kg rice and 3 kg wheat

Output:
{
  "items": [
    { "name": "rice", "quantity": "2 kg" },
    { "name": "wheat", "quantity": "3 kg" }
  ]
}

MESSAGE:
"""${message}"""
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(text);

    if (!parsed.items || !Array.isArray(parsed.items)) {
      throw new Error("Invalid structure");
    }

    return parsed;
  } catch (err) {
    console.log("⚠️ AI failed, using fallback");

    // fallback
    return {
      items: message.split("and").map((p) => ({
        name: cleanName(p),
        quantity: "1 unit",
      })),
    };
  }
}

// ─── ROUTES ─────────────────────────────

// HOME
app.get("/", (req, res) => {
  res.send("🚀 Backend Running");
});

// CHAT
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const aiResult = await extractProductInfo(message);

    console.log("AI RESULT:", aiResult);

    const itemsWithPrices = aiResult.items.map((item) => ({
      name: cleanName(item.name),
      quantity: item.quantity,
      suggestedPrice: suggestMarketPrice(item.name),
      imageUrl: null,
    }));

    const product = new Product({
      items: itemsWithPrices,
    });

    await product.save();

    res.json({
      message: "AI processed successfully",
      items: itemsWithPrices,
      productId: product._id,
      nextStep: "UPLOAD_IMAGES",
    });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
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
    if (!product) return res.status(404).json({ error: "Not found" });

    const order = new Order({
      productId,
      buyerName,
      address,
      status: "PLACED",
    });

    await order.save();

    res.json({
      message: "Order placed",
      order,
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

// UPDATE STATUS
app.post("/update-status", async (req, res) => {
  const { orderId, status } = req.body;

  const updated = await Order.findByIdAndUpdate(
    orderId,
    { status },
    { new: true }
  );

  res.json({
    message: "Updated",
    order: updated,
  });
});

// IMAGE UPLOAD
app.post("/upload-image", async (req, res) => {
  try {
    const { productId, itemIndex, imageUrl } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    if (!product.items[itemIndex]) {
      return res.status(400).json({ error: "Invalid item index" });
    }

    product.items[itemIndex].imageUrl = imageUrl;

    const allUploaded = product.items.every((i) => i.imageUrl);

    if (allUploaded) {
      product.status = "LIVE";
    }

    await product.save();

    res.json({
      message: "Image uploaded successfully",
      product,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// START SERVER
app.listen(3000, () => {
  console.log("Server running on port 3000");
});