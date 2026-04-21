const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const Groq = require("groq-sdk");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ───────────────── ENV ─────────────────
console.log("MONGO_URI =", !!process.env.MONGO_URI);
console.log("GROQ_KEY =", !!process.env.GROQ_API_KEY);
console.log("MANDI_KEY =", !!process.env.MANDI_API);

// ───────────────── GROQ ─────────────────
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// ───────────────── DB ─────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ───────────────── SCHEMAS ─────────────────
const productSchema = new mongoose.Schema({
  sellerId: String,
  name: String,
  quantity: String,
  suggestedPrice: String,
  status: { type: String, default: "LIVE" },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model("Product", productSchema);

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

const notificationSchema = new mongoose.Schema({
  sellerId: String,
  orderId: String,
  message: String,
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model("Notification", notificationSchema);
// ───────────────── VOICE TO TEXT ─────────────────
app.post("/voice", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    // Send audio to Groq Whisper
    const transcription = await groq.audio.transcriptions.create({
      file: require("fs").createReadStream(req.file.path),
      model: "whisper-large-v3"
    });

    const text = transcription.text;

    // 🔁 Reuse your existing chat logic
    const fakeReq = {
      body: {
        sellerId: req.body.sellerId,
        message: text
      }
    };

    const fakeRes = {
      json: (data) => res.json({ ...data, voiceText: text }),
      status: (code) => res.status(code)
    };

    // Call your existing /chat logic
    app._router.handle(fakeReq, fakeRes, require("http").METHODS);

  } catch (err) {
    console.error("Voice error:", err);
    res.status(500).json({ error: "Voice processing failed" });
  }
});

// ───────────────── MEMORY ─────────────────
const pending = {};

// ───────────────── FALLBACK PRICE ─────────────────
function getPrice(name = "") {
  const n = name.toLowerCase();

  if (n.includes("onion")) return "₹30/kg";
  if (n.includes("potato")) return "₹20/kg";
  if (n.includes("rice")) return "₹50/kg";
  if (n.includes("wheat")) return "₹35/kg";
  // Vegetables
if (n.includes("carrot")) return "₹25/kg";
if (n.includes("cabbage")) return "₹18/kg";
if (n.includes("cauliflower")) return "₹30/kg";
if (n.includes("spinach")) return "₹15/kg";
if (n.includes("brinjal")) return "₹35/kg";
if (n.includes("capsicum")) return "₹60/kg";
if (n.includes("peas")) return "₹80/kg";
if (n.includes("radish")) return "₹20/kg";
if (n.includes("beetroot")) return "₹35/kg";
if (n.includes("cucumber")) return "₹25/kg";
if (n.includes("pumpkin")) return "₹20/kg";
if (n.includes("bottle gourd")) return "₹22/kg";
if (n.includes("lauki")) return "₹22/kg";
if (n.includes("bitter gourd")) return "₹45/kg";
if (n.includes("karela")) return "₹45/kg";
if (n.includes("ladyfinger")) return "₹50/kg";
if (n.includes("okra")) return "₹50/kg";
if (n.includes("beans")) return "₹70/kg";
if (n.includes("garlic")) return "₹120/kg";
if (n.includes("ginger")) return "₹100/kg";
if (n.includes("green chilli")) return "₹60/kg";
if (n.includes("chilli")) return "₹60/kg";
if (n.includes("sweet corn")) return "₹25/piece";

// Fruits
if (n.includes("apple")) return "₹120/kg";
if (n.includes("banana")) return "₹40/dozen";
if (n.includes("mango")) return "₹80/kg";
if (n.includes("orange")) return "₹60/kg";
if (n.includes("grapes")) return "₹90/kg";
if (n.includes("pineapple")) return "₹50/piece";
if (n.includes("papaya")) return "₹30/kg";
if (n.includes("watermelon")) return "₹20/kg";
if (n.includes("muskmelon")) return "₹25/kg";
if (n.includes("guava")) return "₹50/kg";
if (n.includes("pomegranate")) return "₹150/kg";
if (n.includes("litchi")) return "₹120/kg";
if (n.includes("pear")) return "₹100/kg";
if (n.includes("plum")) return "₹120/kg";

// Grains
if (n.includes("maize")) return "₹25/kg";
if (n.includes("corn")) return "₹25/kg";
if (n.includes("barley")) return "₹30/kg";
if (n.includes("millet")) return "₹28/kg";
if (n.includes("bajra")) return "₹28/kg";
if (n.includes("jowar")) return "₹30/kg";
if (n.includes("oats")) return "₹70/kg";

// Pulses
if (n.includes("lentils")) return "₹90/kg";
if (n.includes("dal")) return "₹90/kg";
if (n.includes("chickpeas")) return "₹80/kg";
if (n.includes("chana")) return "₹80/kg";
if (n.includes("kidney beans")) return "₹120/kg";
if (n.includes("rajma")) return "₹120/kg";
if (n.includes("black gram")) return "₹100/kg";
if (n.includes("urad")) return "₹100/kg";
if (n.includes("green gram")) return "₹95/kg";
if (n.includes("moong")) return "₹95/kg";
if (n.includes("arhar")) return "₹110/kg";
if (n.includes("toor")) return "₹110/kg";

// Dairy
if (n.includes("curd")) return "₹60/kg";
if (n.includes("paneer")) return "₹300/kg";
if (n.includes("butter")) return "₹500/kg";
if (n.includes("ghee")) return "₹600/kg";

// Poultry
if (n.includes("chicken")) return "₹220/kg";

// Oils
if (n.includes("mustard oil")) return "₹150/L";
if (n.includes("sunflower oil")) return "₹140/L";
if (n.includes("groundnut oil")) return "₹160/L";

// Spices
if (n.includes("turmeric")) return "₹120/kg";
if (n.includes("haldi")) return "₹120/kg";
if (n.includes("coriander")) return "₹100/kg";
if (n.includes("dhania")) return "₹100/kg";
if (n.includes("cumin")) return "₹300/kg";
if (n.includes("jeera")) return "₹300/kg";
if (n.includes("black pepper")) return "₹600/kg";
if (n.includes("pepper")) return "₹600/kg";
if (n.includes("cardamom")) return "₹1200/kg";
if (n.includes("elaichi")) return "₹1200/kg";

// Sugar & basics
if (n.includes("jaggery")) return "₹50/kg";
if (n.includes("gur")) return "₹50/kg";
if (n.includes("salt")) return "₹20/kg";

// Flowers
if (n.includes("marigold")) return "₹40/kg";
if (n.includes("rose")) return "₹5/piece";
if (n.includes("jasmine")) return "₹200/kg";

// Dry fruits
if (n.includes("almond")) return "₹700/kg";
if (n.includes("badam")) return "₹700/kg";
if (n.includes("cashew")) return "₹800/kg";
if (n.includes("kaju")) return "₹800/kg";
if (n.includes("raisin")) return "₹300/kg";
if (n.includes("kishmish")) return "₹300/kg";

// Others
if (n.includes("flour")) return "₹40/kg";
if (n.includes("atta")) return "₹40/kg";
if (n.includes("bread")) return "₹40/packet";

  return "₹100 (estimate)";
}

// ───────────────── MANDI API (STRONG MATCH FIX) ─────────────────
async function getLivePrice(item) {
  try {
    console.log("Searching mandi price for:", item);

    const API_KEY = process.env.MANDI_API;

    const url = `https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24?api-key=${API_KEY}&format=json&limit=100`;

    const res = await axios.get(url);
    const records = res.data.records || [];

    const itemClean = item.toLowerCase().trim();

    for (const r of records) {
      const nameField = (
        r.commodity ||
        r.commodity_name ||
        r.crop ||
        ""
      ).toLowerCase();

      const priceField =
        r.modal_price ||
        r.price ||
        r.max_price ||
        r.min_price;

      // ✅ STRICT MATCH (FIXED)
      if (
        itemClean &&
        (nameField === itemClean ||
         nameField.includes(itemClean) ||
         itemClean.includes(nameField)) &&
        priceField
      ) {
        console.log("Matched:", nameField, priceField);

        const pricePerKg = parseFloat(priceField) / 100;
        return `₹${pricePerKg.toFixed(2)}/kg`;
      }
    }

    console.log("No mandi match, using fallback");
    return getPrice(item);

  } catch (err) {
    console.error("Mandi API error:", err.message);
    return getPrice(item);
  }
}

// ───────────────── SELL INTENT ─────────────────
function isSellIntent(message) {
  const msg = message.toLowerCase();
  return msg.includes("sell") || msg.includes("bechna") || /\d+/.test(msg);
}

// ───────────────── FALLBACK EXTRACTION (FIXED) ─────────────────
// ───────────────── FALLBACK EXTRACTION (FULLY FIXED) ─────────────────
function extractItemsFallback(message) {
  const msg = message.toLowerCase();

  // Pattern 1: "5 kg onion"
  let match = msg.match(/(\d+)\s?(kg|g|litre|l|pcs|pieces)?\s+([a-z]+)/);

  // Pattern 2: "onion 5 kg"
  if (!match) {
    match = msg.match(/([a-z]+)\s+(\d+)\s?(kg|g|litre|l|pcs|pieces)/);
    if (match) {
      return [{
        name: match[1],
        quantity: `${match[2]} ${match[3]}`
      }];
    }
  }

  if (match) {
    return [{
      name: match[3],
      quantity: match[2] ? `${match[1]} ${match[2]}` : `${match[1]} unit`
    }];
  }

  // fallback safe
  return [{
    name: msg.split(" ").find(w => isNaN(w)) || "unknown",
    quantity: "1 unit"
  }];
}

// ───────────────── GROQ AI EXTRACTION (STRICT FIX) ─────────────────
async function extractItemsAI(message) {
  try {
    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        {
          role: "system",
          content: `
Extract ALL items with quantity.

STRICT RULES:
- Ignore words like: i, want, to, sell, bechna
- Only return actual items (onion, potato, rice, etc.)
- Quantity must be number + unit

Return ONLY JSON:
[
 { "name": "item", "quantity": "2 kg" }
]
`
        },
        {
          role: "user",
          content: message
        }
      ]
    });

    let text = completion.choices[0].message.content.trim();
    text = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return extractItemsFallback(message);
    }

    return parsed.map(i => ({
      name: (i.name || "").toLowerCase().trim(),
      quantity: i.quantity || "1 unit"
    })).filter(i => i.name); // remove empty

  } catch (err) {
    console.error("Groq error:", err.message);
    return extractItemsFallback(message);
  }
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

    const items = await extractItemsAI(message);

    const enriched = await Promise.all(
      items.map(async (i) => ({
        name: i.name,
        quantity: i.quantity,
        suggestedPrice: await getLivePrice(i.name)
      }))
    );

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

// ───────────────── UPDATE STATUS ─────────────────
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

    try {
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