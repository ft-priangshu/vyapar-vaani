const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ─── ENV CHECK ────────────────────────────────────────────────────────────────
console.log("MONGO_URI    =", !!process.env.MONGO_URI);
console.log("GEMINI_KEY   =", !!process.env.GEMINI_API_KEY);

// ─── GEMINI ───────────────────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── MONGOOSE ─────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB error:", err));

// ─── MODELS ───────────────────────────────────────────────────────────────────

// Product listed on marketplace
const productSchema = new mongoose.Schema({
  sellerId: { type: String, required: true },   // identify which seller owns this
  name:     { type: String, required: true },
  quantity: { type: String, required: true },
  suggestedPrice: String,
  status:   { type: String, default: "LIVE" },   // LIVE | SOLD
  createdAt:{ type: Date,   default: Date.now }
});
const Product = mongoose.model("Product", productSchema);

// Order placed by a buyer
const orderSchema = new mongoose.Schema({
  productId:   { type: String, required: true },
  productName: String,
  quantity:    String,
  sellerId:    String,
  // Buyer details (captured at purchase)
  buyerName:   { type: String, required: true },
  phone:       { type: String, required: true },
  address:     { type: String, required: true },
  // Logistics
  status:      { type: String, default: "PLACED" },
  // PLACED → ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED
  assignedTo:  { type: String, default: "UNASSIGNED" },
  createdAt:   { type: Date,   default: Date.now }
});
const Order = mongoose.model("Order", orderSchema);

// Seller notification feed  (the "chat" updates seller sees)
const notifSchema = new mongoose.Schema({
  sellerId:  { type: String, required: true },
  productId: String,
  orderId:   String,
  type:      String,   // ORDER_PLACED | ORDER_ASSIGNED | STATUS_UPDATE
  message:   String,
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model("Notification", notifSchema);

// ─── TEMP PENDING SALES (in-memory, TTL 10 min) ───────────────────────────────
const pendingSales = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingSales) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingSales.delete(key);
  }
}, 60 * 1000);

// ─── PRICE ENGINE ─────────────────────────────────────────────────────────────
function getPrice(name = "") {
  const n = name.toLowerCase();
  if (n.includes("potato"))  return "₹20/kg";
  if (n.includes("onion"))   return "₹30/kg";
  if (n.includes("rice"))    return "₹50/kg";
  if (n.includes("wheat"))   return "₹35/kg";
  if (n.includes("tomato"))  return "₹40/kg";
  if (n.includes("milk"))    return "₹55/L";
  if (n.includes("carrot"))  return "₹25/kg";
  if (n.includes("cabbage")) return "₹18/kg";
  if (n.includes("spinach")) return "₹15/kg";
  if (n.includes("mango"))   return "₹80/kg";
  return "₹100 (estimate)";
}

// ─── CLEAN NAME ───────────────────────────────────────────────────────────────
function cleanName(name = "") {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(kg|g|gram|grams|litre|liter|l|pcs|piece|pieces)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── GEMINI JSON SAFE PARSE ───────────────────────────────────────────────────
// Layer 1: strip fences  Layer 2: find first JSON array  Layer 3: regex fallback
function safeParseGeminiJSON(raw) {
  // Strip markdown fences if present
  let text = raw.replace(/```json[\s\S]*?```/g, (m) => m.replace(/```json|```/g, "")).trim();
  text = text.replace(/```/g, "").trim();

  // Layer 1 – direct parse
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    // Gemini sometimes wraps in an object: { items: [...] }
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch (_) {}

  // Layer 2 – extract first [...] block from the string
  const arrayMatch = text.match(/\[[\s\S]*?\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
  }

  // Layer 3 – return null so caller uses regex fallback
  return null;
}

// ─── REGEX FALLBACK PARSER ────────────────────────────────────────────────────
// Handles plain text like "5 kg potato, 10 kg onion" when Gemini fails entirely
function regexFallbackExtract(message) {
  const results = [];
  // Match patterns like: "5 kg potato", "10kg onion", "3 litre milk"
  const pattern = /(\d+(?:\.\d+)?)\s*(kg|g|gram|grams|litre|liter|l|pcs|piece|pieces|unit)?\s+([a-zA-Z]+)/gi;
  let match;
  while ((match = pattern.exec(message)) !== null) {
    const qty  = match[1];
    const unit = match[2] || "unit";
    const name = match[3];
    results.push({ name: cleanName(name), quantity: `${qty} ${unit}` });
  }
  // If nothing matched, treat whole message as a single product
  if (results.length === 0) {
    results.push({ name: cleanName(message), quantity: "1 unit" });
  }
  return results;
}

// ─── GEMINI EXTRACTOR ─────────────────────────────────────────────────────────
async function extractItems(message) {
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
You are a produce extraction assistant for an Indian farmers marketplace.

Seller message: "${message}"

Extract every product the seller mentions. Return a JSON array:
[
  { "name": "product name only (no units)", "quantity": "number + unit e.g. 5 kg" }
]

Rules:
- "2 kg potato and 10 kg onion" → [{"name":"potato","quantity":"2 kg"},{"name":"onion","quantity":"10 kg"}]
- Always preserve the exact quantity with unit.
- If no unit is mentioned, use "unit".
- Lowercase names only.
- Return ONLY a valid JSON array. No markdown, no explanation, no extra text.
`;

    const result = await model.generateContent(prompt);
    const raw    = result.response.text();
    const arr    = safeParseGeminiJSON(raw);

    if (arr && arr.length > 0) {
      return arr
        .filter((item) => item && item.name)
        .map((item) => ({
          name:     cleanName(item.name),
          quantity: (item.quantity || "1 unit").toString().trim()
        }));
    }

    // Gemini returned unparseable output — use regex fallback
    console.warn("Gemini JSON unparseable, using regex fallback. Raw:", raw);
    return regexFallbackExtract(message);

  } catch (e) {
    console.error("Gemini extract error:", e.message);
    return regexFallbackExtract(message);
  }
}

// ─── ROUTE: SELLER CHAT (Step 1 – AI extracts + suggests price) ───────────────
//  POST /chat
//  Body: { sellerId, message }
//  NOTE: sellerId is auto-generated if missing, and returned so frontend can
//        store it for all subsequent calls. Frontend MUST persist this value.
app.post("/chat", async (req, res) => {
  try {
    let { sellerId, message } = req.body;

    if (!message || !message.trim())
      return res.status(400).json({ error: "message is required" });

    // Auto-generate sellerId if frontend forgot to send it
    // Return it in response so frontend can store and reuse it
    const sellerIdGenerated = !sellerId;
    if (!sellerId || typeof sellerId !== "string" || !sellerId.trim()) {
      sellerId = "seller_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    }
    sellerId = sellerId.trim().slice(0, 64); // sanitize length

    const items = await extractItems(message);

    const suggestions = items.map((item) => ({
      name:           item.name,
      quantity:       item.quantity,
      suggestedPrice: getPrice(item.name)
    }));

    // Store each item under a unique tempId
    const tempId = Date.now().toString();
    pendingSales.set(tempId, { sellerId, items: suggestions, createdAt: Date.now() });

    res.json({
      message:          `Found ${suggestions.length} item(s). Confirm to list all on marketplace?`,
      tempId,
      sellerId,                          // always echo back so frontend can store it
      sellerIdGenerated,                 // true = frontend should save this new ID
      suggestions,
      nextStep:         "CONFIRMATION_REQUIRED"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── ROUTE: CONFIRM SELL (Step 2 – lists products on marketplace) ─────────────
//  POST /confirm-sell
//  Body: { tempId, confirm: true/false }
app.post("/confirm-sell", async (req, res) => {
  try {
    const { tempId, confirm } = req.body;

    if (!pendingSales.has(tempId))
      return res.status(400).json({ error: "Session expired or not found. Please re-enter your products." });

    const { sellerId, items } = pendingSales.get(tempId);
    pendingSales.delete(tempId);

    if (!confirm)
      return res.json({ message: "Sale cancelled. You can list again anytime." });

    // Save all extracted products to DB
    const saved = await Product.insertMany(
      items.map((item) => ({
        sellerId,
        name:           item.name,
        quantity:       item.quantity,
        suggestedPrice: item.suggestedPrice,
        status:         "LIVE"
      }))
    );

    // Notify seller in their chat feed
    await Notification.insertMany(
      saved.map((p) => ({
        sellerId,
        productId: p._id.toString(),
        type:      "LISTED",
        message:   `✅ "${p.name}" (${p.quantity}) listed at ${p.suggestedPrice}`
      }))
    );

    res.json({
      message:  `${saved.length} product(s) listed on marketplace successfully!`,
      products: saved
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Confirm error" });
  }
});

// ─── ROUTE: MARKETPLACE – get products ───────────────────────────────────────
//  GET /products           → returns only LIVE products (default)
//  GET /products?status=ALL  → returns every product (for admin/debug)
//  GET /products?status=SOLD → returns sold products
//  Each product includes _id, name, quantity, suggestedPrice, status, sellerId, createdAt
app.get("/products", async (req, res) => {
  try {
    const { status, sellerId } = req.query;

    const filter = {};

    // Default: only LIVE unless explicitly asked for something else
    if (!status || status === "LIVE") {
      filter.status = "LIVE";
    } else if (status !== "ALL") {
      filter.status = status.toUpperCase();
    }

    if (sellerId) filter.sellerId = sellerId.trim();

    const products = await Product.find(filter)
      .sort({ createdAt: -1 })
      .lean();   // plain JS objects — avoids Mongoose getter surprises

    res.json({
      count:    products.length,
      products              // always an array, never null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not fetch products" });
  }
});

// ─── ROUTE: BUY – buyer places order with full details ────────────────────────
//  POST /buy
//  Body: { productId, buyerName, phone, address }
app.post("/buy", async (req, res) => {
  try {
    const { productId, buyerName, phone, address } = req.body;

    if (!productId || !buyerName || !phone || !address)
      return res.status(400).json({ error: "productId, buyerName, phone, address are all required" });

    const product = await Product.findById(productId);
    if (!product)
      return res.status(404).json({ error: "Product not found" });

    if (product.status !== "LIVE")
      return res.status(400).json({ error: "Product is no longer available" });

    // Create order
    const order = new Order({
      productId,
      productName: product.name,
      quantity:    product.quantity,
      sellerId:    product.sellerId,
      buyerName,
      phone,
      address,
      status:      "PLACED",
      assignedTo:  "UNASSIGNED"
    });
    await order.save();

    // Mark product sold
    product.status = "SOLD";
    await product.save();

    // Notify seller in their chat feed
    await Notification.create({
      sellerId:  product.sellerId,
      productId: productId,
      orderId:   order._id.toString(),
      type:      "ORDER_PLACED",
      message:   `🛒 New order for "${product.name}" (${product.quantity}) by ${buyerName} | 📞 ${phone} | 📍 ${address}`
    });

    res.json({
      message: "Order placed successfully! Seller has been notified.",
      order
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Buy failed" });
  }
});

// ─── ROUTE: SELLER NOTIFICATIONS (seller's chat updates) ─────────────────────
//  GET /notifications/:sellerId
app.get("/notifications/:sellerId", async (req, res) => {
  const notifs = await Notification.find({ sellerId: req.params.sellerId })
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(notifs);
});

// ─── ROUTE: LOGISTICS – all orders (admin dashboard) ─────────────────────────
//  GET /orders
app.get("/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});

// ─── ROUTE: ADMIN – assign order to employee ─────────────────────────────────
//  POST /assign-order
//  Body: { orderId, employee }
app.post("/assign-order", async (req, res) => {
  try {
    const { orderId, employee } = req.body;
    if (!orderId || !employee)
      return res.status(400).json({ error: "orderId and employee required" });

    const order = await Order.findByIdAndUpdate(
      orderId,
      { assignedTo: employee, status: "ASSIGNED" },
      { new: true }
    );
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Notify seller
    await Notification.create({
      sellerId:  order.sellerId,
      productId: order.productId,
      orderId:   orderId,
      type:      "ORDER_ASSIGNED",
      message:   `🚚 Delivery for "${order.productName}" has been assigned to ${employee}`
    });

    res.json({ message: "Order assigned", order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Assign failed" });
  }
});

// ─── ROUTE: ADMIN – update order status ──────────────────────────────────────
//  POST /update-status
//  Body: { orderId, status }
//  Valid statuses: PLACED | ASSIGNED | PICKED_UP | IN_TRANSIT | DELIVERED
const VALID_STATUSES = ["PLACED", "ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];

const STATUS_MESSAGES = {
  PICKED_UP:  "📦 Your product has been picked up by the delivery agent.",
  IN_TRANSIT: "🚛 Your product is on the way to the buyer.",
  DELIVERED:  "✅ Your product has been delivered successfully!"
};

app.post("/update-status", async (req, res) => {
  try {
    const { orderId, status } = req.body;

    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ error: `Status must be one of: ${VALID_STATUSES.join(", ")}` });

    const order = await Order.findByIdAndUpdate(orderId, { status }, { new: true });
    if (!order) return res.status(404).json({ error: "Order not found" });

    // Send meaningful update to seller's notification feed
    const notifMsg = STATUS_MESSAGES[status]
      ? `${STATUS_MESSAGES[status]} (Order: "${order.productName}" → ${order.buyerName})`
      : `📋 Order for "${order.productName}" status changed to ${status}`;

    await Notification.create({
      sellerId:  order.sellerId,
      productId: order.productId,
      orderId:   orderId,
      type:      "STATUS_UPDATE",
      message:   notifMsg
    });

    res.json({ message: "Status updated and seller notified", order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Status update failed" });
  }
});

// ─── ROUTE: ADMIN – full order report for a product ──────────────────────────
//  GET /order-report/:orderId
app.get("/order-report/:orderId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const timeline = await Notification.find({ orderId: req.params.orderId })
      .sort({ createdAt: 1 });

    res.json({
      order,
      timeline: timeline.map((n) => ({
        time:    n.createdAt,
        type:    n.type,
        message: n.message
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Report failed" });
  }
});

// ─── SERVER ───────────────────────────────────────────────────────────────────
app.listen(3000, () => console.log("Server running on port 3000"));
