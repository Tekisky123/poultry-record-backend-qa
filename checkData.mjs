import mongoose from "mongoose";
import InventoryStock from "./src/models/InventoryStock.js";
import Trip from "./src/models/Trip.js";
import connectDB from "./src/configs/database.js";

async function run() {
    await connectDB();

    const end = new Date("2025-01-09");
    end.setHours(23, 59, 59, 999);

    const query = { date: { $lte: end }, inventoryType: "bird" };
    const inventoryStocks = await InventoryStock.find(query).lean();
    
    let tripQuery = {};
    const trips = await Trip.find({ ...tripQuery, stocks: { $exists: true, $not: { $size: 0 } } }).lean();
    
    let tripStocks = trips.flatMap(trip =>
        trip.stocks.map(s => ({
            _id: s._id,
            source: "trip",
            inventoryType: "bird",
            type: "purchase",
            birds: s.birds,
            weight: s.weight,
            amount: s.value,
            date: s.addedAt
        }))
    );
    tripStocks = tripStocks.filter(s => new Date(s.date) <= end && s.inventoryType === "bird");

    const allStocks = [...inventoryStocks, ...tripStocks].sort((a,b) => new Date(b.date) - new Date(a.date));

    // Anchor Date logic
    const opStocks = allStocks.filter(s => s.type === "opening");
    const firstOpStock = opStocks.length > 0 ? opStocks.sort((a,b) => new Date(a.date) - new Date(b.date))[0] : null;

    let birdAnchorDate = new Date(0);
    if (firstOpStock) {
        const d = new Date(firstOpStock.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        birdAnchorDate = new Date(`${m >= 3 ? y : y - 1}-04-01T00:00:00`);
    }

    let bOpW = 0, bPurchW = 0, bSaleW = 0, bMortW = 0, bLossW = 0;
    
    allStocks.forEach(s => {
        const date = new Date(s.date);
        if (s.type === "opening") {
            if (!firstOpStock || String(s._id) !== String(firstOpStock._id)) return;
        } else {
            if (date < birdAnchorDate) return;
        }

        const w = Number(s.weight) || 0;
        if (s.type === "opening") bOpW += w;
        else if (s.type === "purchase") bPurchW += w;
        else if (s.type === "sale" || s.type === "receipt") bSaleW += w;
        else if (s.type === "mortality") bMortW += w;
        else if (s.type === "weight_loss" || s.type === "natural_weight_loss") bLossW += w;
    });

    const finalWeight = bOpW + bPurchW - bSaleW - bMortW - bLossW;
    console.log("MANAGE_STOCKS equivalent = ", {bOpW, bPurchW, bSaleW, bMortW, bLossW, finalWeight});

    // Now with startOfMonth LivePoultry logic
    const startOfMonth = new Date(2025, 9, 1, 0, 0, 0); 
    
    let lpOpW = 0, lpPurchW = 0, lpOutW = 0;

    let stocksBeforeMonth = [];
    allStocks.forEach(stock => {
        const date = new Date(stock.date);
        if (stock.type === "opening") {
            if (!firstOpStock || String(stock._id) !== String(firstOpStock._id)) return;
        } else {
            if (stock.inventoryType === "bird" && date < birdAnchorDate) return;
        }

        if (date < startOfMonth) {
            stocksBeforeMonth.push(stock);
        }
    });

    stocksBeforeMonth.forEach(s => {
        const w = Number(s.weight) || 0;
        if (s.type === "purchase" || s.type === "opening") {
            lpOpW += w;
        } else if (["sale", "receipt", "mortality", "weight_loss", "natural_weight_loss"].includes(s.type)) {
            lpOutW += w;
        }
    });

    const lpFinalWeight = lpOpW - lpOutW;
    console.log("LIVE_POULTRY equivalent =", {lpOpW, lpOutW, lpFinalWeight});
    
    process.exit(0);
}
run();
