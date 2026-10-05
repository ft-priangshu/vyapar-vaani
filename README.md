# Vyapar Vaani

Vyapar Vaani is an AI-powered agricultural marketplace designed for farmers, FPOs, and small vegetable sellers. It helps sellers list produce using voice or chat input, extract item details automatically, and receive suggested pricing based on market data.

## Overview

The platform aims to reduce dependence on middlemen by enabling direct buyer-seller interaction through a simple digital workflow.

Key capabilities include:
- Voice-based product listing via audio upload
- Chat-based selling flow for text input
- AI-based product and quantity extraction
- Live price estimation using public mandi data and fallback pricing
- Marketplace listing and buyer order creation
- Order status updates and seller notifications

## Problem it solves

Small farmers and local sellers often face challenges such as:
- Unclear or inconsistent market pricing
- Limited access to buyers
- Dependence on intermediaries
- Delayed selling and wastage of fresh produce
- Poor visibility into demand and logistics

Vyapar Vaani addresses these issues by giving sellers a simple way to describe their produce and get AI-assisted pricing and marketplace support.

## Features

### 1. Voice and chat selling
Users can submit product details through:
- /voice for audio transcription
- /chat for natural text messages

The backend uses Groq Whisper and Llama-based extraction to convert spoken or written text into structured items and quantities.

### 2. AI extraction and validation
The app normalizes Hindi, Hinglish, and English product descriptions and extracts:
- crop/item name
- quantity
- suggested price

It also blocks restricted or unsafe categories such as illegal drugs.

### 3. Marketplace
Sellers can confirm listings and publish products with:
- /confirm-sell
- /products

Buyers can place orders with:
- /buy

### 4. Order lifecycle management
The API supports:
- viewing orders via /orders
- updating status with /orders/:id/status
- fetching notifications via /notifications/:sellerId

## Tech stack

- Node.js
- Express.js
- MongoDB with Mongoose
- Groq AI (Whisper + chat completion models)
- Axios for API integration
- Multer for audio uploads
- REST API architecture

## Project structure

```text
vyapar-vaani/
├── server.js
├── package.json
├── package-lock.json
├── .gitignore
├── test.mp3
├── ngrok.exe
├── node_modules/
└── README.md
```

## Environment variables

Create a `.env` file in the root directory with the following values:

```env
MONGO_URI=your_mongodb_connection_string
GROQ_API_KEY=your_groq_api_key
MANDI_API=your_mandi_api_key
```

Note: the server currently runs on port 3000 by default.

## Installation

```bash
git clone https://github.com/ft-priangshu/vyapar-vaani.git
cd vyapar-vaani
npm install
```

## Run locally

```bash
node server.js
```

The app will start on:

```text
http://localhost:3000
```

## API highlights

### Sell via voice
`POST /voice`
- Upload an audio file under the field `audio`
- Returns extracted items, price suggestions, and a temp confirmation ID

### Sell via chat
`POST /chat`
- Accepts JSON with:
  - `sellerId`
  - `message`
- Returns suggested product listing data

### Confirm listing
`POST /confirm-sell`
- Accepts JSON with:
  - `tempId`
  - `confirm`
- Saves products to MongoDB

### View products
`GET /products`

### Buy a product
`POST /buy`
- Accepts:
  - `productId`
  - `buyerName`
  - `phone`
  - `address`

### View orders
`GET /orders`

### Update order status
`PATCH /orders/:id/status`
- Example status values:
  - `PICKUP_PLANNED`
  - `PICKED`
  - `DELIVERED`

### Notifications
`GET /notifications/:sellerId`

## Example use cases

- A farmer says: "I want to sell 10 kg onion"
- The system extracts `onion` and `10 kg`
- It estimates a price and prepares a listing
- Buyer sees the product in the marketplace and places an order
- Seller updates dispatch status and receives notifications

## Notes

This project is a prototype and is designed for local development and experimentation. It uses public data and AI services that require valid API credentials.

## License

This project is currently intended for educational and prototype use.

---

Built for smarter agricultural commerce through voice, AI, and digital marketplace workflows.
