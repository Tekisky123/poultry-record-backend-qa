import mongoose from 'mongoose';
import Trip from '../models/Trip.js';
import InventoryStock from '../models/InventoryStock.js';
import IndirectSale from '../models/IndirectSale.js';

export const getBirdsWeightLossMonthlySummary = async (req, res) => {
    try {
        const { year } = req.query;
        if (!year) {
            return res.status(400).json({ success: false, message: 'Year is required' });
        }

        const numericYear = parseInt(year);
        const startDate = new Date(`${numericYear}-04-01T00:00:00.000Z`);
        const endDate = new Date(`${numericYear + 1}-03-31T23:59:59.999Z`);

        // Group queries - Trip weight loss
        const trips = await Trip.find({
            date: { $gte: startDate, $lte: endDate },
            'summary.birdWeightLoss': { $gt: 0 }
        });

        // InventoryStock weight loss
        const stocks = await InventoryStock.find({
            inventoryType: 'bird',
            type: { $in: ['weight_loss', 'natural_weight_loss'] },
            date: { $gte: startDate, $lte: endDate }
        });

        const monthNames = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];
        const monthlyData = {};

        monthNames.forEach(name => {
            monthlyData[name] = { name, amount: 0, dateObj: null };
        });

        const monthOffsets = {
            3: "April", 4: "May", 5: "June", 6: "July",
            7: "August", 8: "September", 9: "October", 10: "November", 11: "December",
            0: "January", 1: "February", 2: "March"
        };
        
        Object.keys(monthOffsets).forEach(monthIdx => {
            const mIdx = parseInt(monthIdx);
            const y = mIdx >= 3 ? numericYear : numericYear + 1;
            monthlyData[monthOffsets[mIdx]].dateObj = new Date(y, mIdx, 1);
        });

        let totalAmount = 0;

        // Process Trips
        trips.forEach(trip => {
            const docDate = new Date(trip.date);
            const monthIdx = docDate.getMonth();
            const monthName = monthOffsets[monthIdx];

            if (monthName && monthlyData[monthName]) {
                const weightLoss = trip.summary?.birdWeightLoss || 0;
                const avgRate = trip.summary?.avgPurchaseRate || 0;
                const amt = weightLoss * avgRate;
                
                monthlyData[monthName].amount += amt;
                totalAmount += amt;
            }
        });

        // Process Stocks
        stocks.forEach(stock => {
            const docDate = new Date(stock.date);
            const monthIdx = docDate.getMonth();
            const monthName = monthOffsets[monthIdx];

            if (monthName && monthlyData[monthName]) {
                const amt = stock.amount || 0;
                monthlyData[monthName].amount += amt;
                totalAmount += amt;
            }
        });

        // Indirect Sales do not naturally have weight loss tracked in the mongoose schema 
        // as the recalculateSummary overwrites saleWeight = purchaseWeight - mortalityWeight
        // So we skip them for now for safety, avoiding zero values rendering.

        const monthsArray = monthNames.map(name => ({
            name,
            amount: monthlyData[name].amount,
            startDate: monthlyData[name].dateObj
        }));

        res.status(200).json({
            success: true,
            data: {
                months: monthsArray,
                totals: { amount: totalAmount }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getBirdsWeightLossDailyRecords = async (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'Year and month are required' });
        }

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month);

        const startDate = new Date(numericYear, numericMonth - 1, 1);
        const lastDay = new Date(numericYear, numericMonth, 0).getDate();
        const endDate = new Date(numericYear, numericMonth - 1, lastDay, 23, 59, 59, 999);

        // Group queries - Trip weight loss
        const trips = await Trip.find({
            date: { $gte: startDate, $lte: endDate },
            'summary.birdWeightLoss': { $gt: 0 }
        });

        // InventoryStock weight loss
        const stocks = await InventoryStock.find({
            inventoryType: 'bird',
            type: { $in: ['weight_loss', 'natural_weight_loss'] },
            date: { $gte: startDate, $lte: endDate }
        });

        const records = [];
        let totalAmount = 0;

        // Process Trips
        trips.forEach(trip => {
            const docDate = new Date(trip.date);
            const weightLoss = trip.summary?.birdWeightLoss || 0;
            const avgRate = trip.summary?.avgPurchaseRate || 0;
            const amount = weightLoss * avgRate;

            if (amount > 0) {
                totalAmount += amount;
                records.push({
                    date: docDate.toISOString().split('T')[0],
                    particular: 'Trip Weight Loss',
                    reference: trip.tripId || '-',
                    weight: weightLoss,
                    rate: avgRate,
                    amount: amount,
                    tripDbId: trip._id
                });
            }
        });

        // Process Stocks
        stocks.forEach(stock => {
            const amount = stock.amount || 0;
            if (amount > 0) {
                const dateStr = new Date(stock.date).toISOString().split('T')[0];
                totalAmount += amount;
                records.push({
                    date: dateStr,
                    particular: stock.notes || stock.narration || (stock.type === 'natural_weight_loss' ? 'Natural Weight Loss' : 'Stock Weight Loss'),
                    reference: dateStr,
                    weight: stock.weight || 0,
                    rate: stock.rate || 0,
                    amount: amount,
                    isStock: true
                });
            }
        });

        // Sort records by date ascending
        records.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.status(200).json({
            success: true,
            data: {
                records,
                totals: { amount: totalAmount }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
