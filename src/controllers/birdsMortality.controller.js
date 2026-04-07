import mongoose from 'mongoose';
import Trip from '../models/Trip.js';
import InventoryStock from '../models/InventoryStock.js';
import IndirectSale from '../models/IndirectSale.js';

export const getBirdsMortalityMonthlySummary = async (req, res) => {
    try {
        const { year } = req.query;
        if (!year) {
            return res.status(400).json({ success: false, message: 'Year is required' });
        }

        const numericYear = parseInt(year);
        // Financial year: April 1st of `year` to March 31st of `year + 1`
        const startDate = new Date(`${numericYear}-04-01T00:00:00.000Z`);
        const endDate = new Date(`${numericYear + 1}-03-31T23:59:59.999Z`);

        // Group queries - Trip losses
        const trips = await Trip.find({
            'losses.date': { $gte: startDate, $lte: endDate }
        });

        // InventoryStock mortality
        const stocks = await InventoryStock.find({
            inventoryType: 'bird',
            type: 'mortality',
            date: { $gte: startDate, $lte: endDate }
        });

        // IndirectSale mortality
        const indirectSales = await IndirectSale.find({
            'mortality.birds': { $gt: 0 },
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
            trip.losses.forEach(loss => {
                const lossDate = new Date(loss.date);
                if (lossDate >= startDate && lossDate <= endDate) {
                    const monthIdx = lossDate.getMonth();
                    const monthName = monthOffsets[monthIdx];

                    if (monthName && monthlyData[monthName]) {
                        const amt = loss.total || 0; // The total loss amount
                        monthlyData[monthName].amount += amt;
                        totalAmount += amt;
                    }
                }
            });
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

        // Process Indirect Sales
        indirectSales.forEach(sale => {
            const docDate = new Date(sale.date);
            const monthIdx = docDate.getMonth();
            const monthName = monthOffsets[monthIdx];

            if (monthName && monthlyData[monthName]) {
                const amt = sale.mortality?.amount || 0;
                monthlyData[monthName].amount += amt;
                totalAmount += amt;
            }
        });

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

export const getBirdsMortalityDailyRecords = async (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(400).json({ success: false, message: 'Year and month are required' });
        }

        const numericYear = parseInt(year);
        const numericMonth = parseInt(month); // 1 to 12

        const startDate = new Date(numericYear, numericMonth - 1, 1);
        const lastDay = new Date(numericYear, numericMonth, 0).getDate();
        const endDate = new Date(numericYear, numericMonth - 1, lastDay, 23, 59, 59, 999);

        // Group queries - Trip losses
        const trips = await Trip.find({
            'losses.date': { $gte: startDate, $lte: endDate }
        });

        // InventoryStock mortality
        const stocks = await InventoryStock.find({
            inventoryType: 'bird',
            type: 'mortality',
            date: { $gte: startDate, $lte: endDate }
        });

        // IndirectSale mortality
        const indirectSales = await IndirectSale.find({
            'mortality.birds': { $gt: 0 },
            date: { $gte: startDate, $lte: endDate }
        });

        const records = [];
        let totalAmount = 0;

        // Process Trips
        trips.forEach(trip => {
            trip.losses.forEach(loss => {
                const lossDate = new Date(loss.date);
                if (lossDate >= startDate && lossDate <= endDate) {
                    const amount = loss.total || 0;
                    if (amount > 0) {
                        totalAmount += amount;
                        records.push({
                            date: lossDate.toISOString().split('T')[0],
                            particular: (loss.reason && loss.reason.toLowerCase().includes('trip completion')) ? 'Trip Mortality' : (loss.reason || 'Trip Mortality'),
                            reference: trip.tripId || '-',
                            birds: loss.quantity || 0,
                            weight: loss.weight || 0,
                            rate: loss.rate || 0,
                            amount: amount,
                            tripDbId: trip._id
                        });
                    }
                }
            });
        });

        // Process Stocks
        stocks.forEach(stock => {
            const amount = stock.amount || 0;
            if (amount > 0) {
                const dateStr = new Date(stock.date).toISOString().split('T')[0];
                totalAmount += amount;
                records.push({
                    date: dateStr,
                    particular: stock.notes || stock.narration || 'Stock Mortality',
                    reference: dateStr, // requirements: "if its stock then show date"
                    birds: stock.birds || 0,
                    weight: stock.weight || 0,
                    rate: stock.rate || 0,
                    amount: amount,
                    isStock: true
                });
            }
        });

        // Process Indirect Sales
        indirectSales.forEach(sale => {
            const amount = sale.mortality?.amount || 0;
            if (amount > 0) {
                totalAmount += amount;
                records.push({
                    date: new Date(sale.date).toISOString().split('T')[0],
                    particular: (sale.notes && sale.notes.toLowerCase().includes('indirect')) ? 'Indirect Mortality' : (sale.notes || 'Indirect Mortality'),
                    reference: sale.invoiceNumber || '-', // requirements: "if its indirect purchase sale then show invocie no"
                    birds: sale.mortality?.birds || 0,
                    weight: sale.mortality?.weight || 0,
                    rate: sale.mortality?.rate || 0,
                    amount: amount,
                    indirectDbId: sale._id
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
