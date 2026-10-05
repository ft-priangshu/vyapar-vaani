# Vyapar Vaani 🥬

Vyapar Vaani is an AI-powered digital marketplace made mainly for **farmers, FPOs and small vegetable sellers**.

The main idea behind the project is simple — farmers should be able to know the right price for their products, find buyers directly and get support with delivery and logistics without depending completely on middlemen.

## 🚀 What Problem Are We Solving?

Small farmers and local vegetable sellers often face problems like:

* Not knowing the current/fair market price
* Depending on middlemen to sell their products
* Difficulty finding buyers
* Wastage of vegetables because of delayed selling
* Lack of proper transportation and delivery support
* Difficulty understanding market demand

Because of these problems, farmers may get a lower price while consumers may still have to pay a higher price.

**Vyapar Vaani** tries to bring the farmer and buyer closer through one platform.

---

## 💡 Our Solution

Vyapar Vaani provides a simple platform where a seller can enter details about their product and get AI-based suggestions.

The platform can help with:

1. **Product Listing**

   * Sellers can add vegetables/products
   * Add quantity, expected price and other details
   * Products can be displayed in the marketplace

2. **AI Price Suggestion**

   * AI analyzes the product information and provides a suggested price
   * This can help sellers make better pricing decisions

3. **Digital Marketplace**

   * Buyers can view available products
   * Farmers/FPOs can list their products directly
   * Helps reduce unnecessary middlemen

4. **Logistics Support**

   * Once an order is placed, logistics can be managed through the platform
   * Pickup and delivery status can be tracked
   * The system can help assign suitable logistics partners

5. **Demand Forecasting**

   * AI can be used to analyze previous sales and market data
   * This can help predict which products may have higher demand

6. **Route Optimization**

   * Delivery routes can be optimized to reduce unnecessary travel
   * This can help reduce delivery time and transportation costs

---

## 🔄 How It Works

```text
Farmer / Seller
       ↓
Enter Product Details
       ↓
AI analyzes the information
       ↓
Price Suggestion
       ↓
Product Listed on Marketplace
       ↓
Buyer Places Order
       ↓
Order Confirmed
       ↓
Logistics Partner Assigned
       ↓
Pickup & Delivery
```

---

## 🧠 AI Features

The AI part of Vyapar Vaani can be used for:

* Product information extraction
* Price recommendation
* Demand prediction
* Market trend analysis
* Route optimization
* Future recommendation of products based on demand

The goal is not to make the system complicated for the farmer. The AI should work in the background while the user gets simple and understandable results.

---

## 🛠️ Tech Stack

### Frontend

* HTML
* CSS
* JavaScript

### Backend

* Node.js
* Express.js

### Database

* MongoDB

### AI / ML

* AI-based product and price analysis
* Demand forecasting
* Future integration with ML models

### Other

* Git & GitHub
* REST APIs

---

## 📂 Project Structure

```text
vyapar-vaani/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── routes/
│
├── models/
│
├── server.js
├── package.json
├── .env
└── README.md
```

*The structure may change as the project is developed further.*

---

## ⚙️ Running the Project Locally

### 1. Clone the repository

```bash
git clone https://github.com/ft-priangshu/vyapar-vaani.git
```

### 2. Go to the project folder

```bash
cd vyapar-vaani
```

### 3. Install dependencies

```bash
npm install
```

### 4. Create `.env`

Add the required environment variables in the `.env` file.

Example:

```env
MONGO_URI=your_mongodb_connection_string
PORT=3000
```

### 5. Start the server

```bash
npm start
```

or

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

---

## 📌 Current Features

* [x] Basic seller interface
* [x] Product information input
* [x] Product listing concept
* [x] Marketplace interface
* [x] Backend API
* [x] Database integration
* [ ] AI-based dynamic pricing
* [ ] Demand forecasting
* [ ] Logistics partner assignment
* [ ] Route optimization
* [ ] Real-time delivery tracking

---

## 🎯 Future Scope

There are many things that can be added to Vyapar Vaani in the future:

* Voice-based interaction in regional languages
* WhatsApp integration
* Real-time market prices
* More accurate ML-based price prediction
* Weather-based recommendations
* Crop demand prediction
* Digital payments
* Buyer verification
* Logistics partner dashboard
* Live order tracking
* Multi-language support
* Integration with ONDC and other marketplaces

---

## 🌱 Why Vyapar Vaani?

We wanted to build something that is not only a normal e-commerce website but actually solves a real-world problem.

Farmers and small sellers should not need to understand complicated technology to use the platform. The idea is to keep the interface simple while using AI in the backend to make pricing, selling and logistics easier.

**Simple for the seller. Smart in the backend.**

---

## 👨‍💻 Team

Built as a hackathon project by our team.

We are working on Vyapar Vaani with the goal of using **AI + marketplace + logistics** to make agricultural selling more efficient.

---

## 📜 License

This project is currently developed for educational and hackathon purposes.
