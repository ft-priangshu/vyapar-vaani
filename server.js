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

// ─── MARKET PRICE ─────────────────────────────
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

// ─── AI EXTRACTION (ROBUST FINAL VERSION) ─────────────────────────────
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
You are a strict JSON extraction system.

Extract products from message.

Return ONLY valid JSON:

{
  "items": [
    {
      "name": "product name",
      "quantity": "quantity with unit"
    }
  ]
}

RULES:
- No explanation
- No markdown
- No extra text
- Always return valid JSON
- If quantity missing → "1 unit"

Message:
"""${message}"""
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    let text = response.text();

    // clean output
    text = text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    try {
      const parsed = JSON.parse(text);

      if (!parsed.items || !Array.isArray(parsed.items)) {
        throw new Error("Invalid structure");
      }

      return parsed;
    } catch (err) {
      console.log("⚠️ Gemini invalid output, using fallback");

      // SMART FALLBACK (NO MORE "unknown")
      const fallbackItems = message
        .split(/and|,/i)
        .map((part) => {
          const words = part.trim().split(" ");

          return {
            name: words.slice(-2).join(" ") || part.trim(),
            quantity: "1 unit",
          };
        })
        .filter((i) => i.name);

      return {
        items: fallbackItems.length ? fallbackItems : [{
          name: message,
          quantity: "1 unit",
        }],
      };
    }
  } catch (err) {
    console.error("Gemini error:", err);

    return {
      items: [
        {
          name: message || "unknown item",
          quantity: "1 unit",
        },
      ],
    };
  }
}

// ─── ROUTES ─────────────────────────────

// HOME
app.get("/", (req, res) => {
  res.send("🚀 Backend Running Successfully");
});

// CHAT (MAIN AI ROUTE)
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const aiResult = await extractProductInfo(message);

    console.log("AI RESULT:", aiResult);

    const itemsWithPrices = aiResult.items.map((item) => ({
      name: item.name,
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

// UPLOAD IMAGE
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
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── START SERVER ─────────────────────────────
app.listen(3000, () => {
  console.log("Server running on port 3000");
});