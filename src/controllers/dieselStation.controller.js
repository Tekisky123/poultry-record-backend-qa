import DieselStation from "../models/DieselStation.js";
import AppError from "../utils/AppError.js";
import { successResponse } from "../utils/responseHandler.js";

export const createDieselStation = async (req, res, next) => {
  try {
    const {
      name,
      location,
      group,
      openingBalance = 0,
      openingBalanceType = 'debit'
    } = req.body;

    const stationData = {
      name,
      location,
      group,
      openingBalance,
      openingBalanceType,
      outstandingBalance: openingBalance,
      outstandingBalanceType: openingBalanceType,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    };

    const station = await DieselStation.create(stationData);
    successResponse(res, "Diesel station created successfully", 201, station);
  } catch (error) {
    next(error);
  }
};

export const getDieselStations = async (req, res, next) => {
  try {
    const stations = await DieselStation.find({ isActive: true })
      .populate('group', 'name')
      .sort({ name: 1 });
    successResponse(res, "Diesel stations fetched successfully", 200, stations);
  } catch (error) {
    next(error);
  }
};

export const updateDieselStation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      name,
      location,
      group,
      openingBalance,
      openingBalanceType
    } = req.body;

    // Find the station first
    const station = await DieselStation.findOne({ _id: id, isActive: true });
    if (!station) {
      throw new AppError("Diesel station not found", 404);
    }

    const updateData = {
      name,
      location,
      group,
      updatedBy: req.user._id,
    };

    // Handle opening balance update logic (simplified)
    // If opening balance changes, we should ideally sync outstanding balance
    // For now, let's just allow updating opening balance and reset outstanding if it matches (assuming no transactions yet)
    // Or just simple update for now as we don't have transaction syncing logic for Diesel Stations yet
    if (openingBalance !== undefined) updateData.openingBalance = openingBalance;
    if (openingBalanceType !== undefined) updateData.openingBalanceType = openingBalanceType;

    // If it's a new setup or override, we might want to sync outstanding. 
    // But since we don't have sync logic, let's just update fields. 
    // The user requested: "add diesel as a ledger entry.. behave like a ledger"

    const updatedStation = await DieselStation.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    successResponse(res, "Diesel station updated successfully", 200, updatedStation);
  } catch (error) {
    next(error);
  }
};

export const deleteDieselStation = async (req, res, next) => {
  try {
    const { id } = req.params;

    const station = await DieselStation.findOneAndUpdate(
      { _id: id, isActive: true },
      { isActive: false, updatedBy: req.user._id },
      { new: true }
    );

    if (!station) {
      throw new AppError("Diesel station not found", 404);
    }

    successResponse(res, "Diesel station deleted successfully", 200, station);
  } catch (error) {
    next(error);
  }
};

import Voucher from "../models/Voucher.js";
import Trip from "../models/Trip.js";
import { toSignedValue, fromSignedValue, addToBalance } from "../utils/balanceUtils.js";

export const getDieselStationDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find the station
    const station = await DieselStation.findOne({ _id: id, isActive: true });
    if (!station) {
      throw new AppError("Diesel station not found", 404);
    }

    // 1. Fetch Trips (Diesel Purchases) - CREDIT for Station
    const trips = await Trip.find({
      "diesel.stations": {
        $elemMatch: {
          $or: [
            { dieselStation: id },
            { stationName: station.name } // Fallback
          ]
        }
      }
    })
      .populate("vehicle", "vehicleNumber")
      .select("tripId date vehicle diesel.stations")
      .sort({ date: -1 });

    // 2. Fetch Vouchers (Payments/Journals)
    // Vouchers where party is this station or journal entry account matches station name
    const vouchers = await Voucher.find({
      isActive: true,
      $or: [
        { "parties.partyId": id },
        { "entries.account": station.name } // Heuristic for journals
      ]
    }).lean();

    const ledgerEntries = [];

    // Process Trips
    trips.forEach(trip => {
      if (trip.diesel && trip.diesel.stations) {
        trip.diesel.stations.forEach(entry => {
          const isMatch = (entry.dieselStation && entry.dieselStation.toString() === id) ||
            (entry.stationName === station.name);

          if (isMatch) {
            ledgerEntries.push({
              _id: entry._id || trip._id,
              date: trip.date,
              type: 'trip',
              particulars: "Diesel Purchase",
              indentNumber: entry.indentNumber || '-',
              vehicleNumber: trip.vehicle?.vehicleNumber || 'Unknown',
              volume: entry.volume,
              rate: entry.rate,
              credit: entry.amount, // Purchase increases liability (Credit)
              debit: 0,
              currentTripId: trip.tripId,
              tripId: trip._id,
              narration: entry.narration
            });
          }
        });
      }
    });

    // Process Vouchers
    vouchers.forEach(voucher => {
      let debit = 0;
      let credit = 0;
      let particulars = voucher.description || voucher.voucherType;

      if (voucher.voucherType === 'Payment') {
        // Payment to station -> Debit (Liability decreases)
        const partyData = voucher.parties?.find(p => p.partyId && p.partyId.toString() === id);
        if (partyData) {
          debit += partyData.amount || 0;
          particulars = `Payment Voucher #${voucher.voucherNo}`;
        }
      } else if (voucher.voucherType === 'Journal') {
        const entry = voucher.entries?.find(e => e.account === station.name);
        if (entry) {
          if (entry.creditAmount > 0) credit += entry.creditAmount;
          if (entry.debitAmount > 0) debit += entry.debitAmount;
          particulars = `Journal Voucher #${voucher.voucherNo}`;
        }
      }

      if (debit > 0 || credit > 0) {
        ledgerEntries.push({
          _id: voucher._id,
          date: voucher.date,
          type: 'voucher',
          particulars: particulars,
          vehicleNumber: '-',
          volume: 0,
          rate: 0,
          credit,
          debit,
          voucherId: voucher._id,
          narration: voucher.narration
        });
      }
    });

    // Sort by date ascending to calculate running balance
    ledgerEntries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Determine Opening Balance Date
    // It should be createdAt, but if there are backdated transactions, it should be before them visually.
    let openingDate = station.createdAt ? new Date(station.createdAt) : new Date(0);
    if (ledgerEntries.length > 0) {
      const firstTransactionDate = new Date(ledgerEntries[0].date);
      if (firstTransactionDate < openingDate) {
        // Set opening date to slightly before the first transaction
        openingDate = new Date(firstTransactionDate.getTime() - 60000); // 1 minute before
      }
    }

    // Add Opening Balance Entry
    const openingEntry = {
      _id: 'opening-balance',
      date: openingDate,
      type: 'opening',
      particulars: "Opening Balance",
      vehicleNumber: '-',
      volume: 0,
      rate: 0,
      credit: station.openingBalanceType === 'credit' ? (station.openingBalance || 0) : 0,
      debit: station.openingBalanceType === 'debit' ? (station.openingBalance || 0) : 0,
      balance: station.openingBalance || 0,
      balanceType: station.openingBalanceType === 'credit' ? 'Cr' : 'Dr'
    };

    // Combine: [Opening Entry, ...Transactions]
    // We force opening entry to be first regardless of its exact timestamp relative to others (though we adjusted date above)
    const allEntries = [openingEntry, ...ledgerEntries];

    // Calculate Running Balance
    let runningBalance = 0; // Start from 0 because Opening Entry will add the initial amount

    const entriesWithBalance = allEntries.map(entry => {
      // Credit increases balance (more payable for liability), Debit decreases balance
      // This assumes standard liability/vendor logic: Credit = Increase, Debit = Decrease
      runningBalance = runningBalance + (entry.credit || 0) - (entry.debit || 0);

      const absBalance = Math.abs(runningBalance);
      const balanceType = runningBalance >= 0 ? 'credit' : 'debit';
      // If runningBalance is positive, it means Credit balance (Liability). 
      // If negative, it means Debit balance (Asset/Advance).

      return {
        ...entry,
        balance: absBalance,
        balanceType: balanceType === 'credit' ? 'Cr' : 'Dr'
      };
    });

    // Return entries in Ascending Order (Opening Balance First)
    // The user requested: "First OP entry, next one by one..."
    let finalEntries = entriesWithBalance;

    // Filter by Date Range if provided
    const { startDate, endDate } = req.query;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      // Set end date to end of day
      end.setHours(23, 59, 59, 999);

      // Find entries before start date to calculate opening balance for the period
      const previousEntries = entriesWithBalance.filter(e => new Date(e.date) < start);
      const periodEntries = entriesWithBalance.filter(e => {
        const d = new Date(e.date);
        return d >= start && d <= end;
      });

      let periodOpeningBalance = 0;
      let periodOpeningType = 'credit';

      if (previousEntries.length > 0) {
        const lastPrevEntry = previousEntries[previousEntries.length - 1];
        const absBal = lastPrevEntry.balance;
        const type = lastPrevEntry.balanceType;
        const signedBal = type === 'Cr' ? absBal : -absBal;
        periodOpeningBalance = Math.abs(signedBal);
        periodOpeningType = signedBal >= 0 ? 'credit' : 'debit';
      }

      const periodOpeningEntry = {
        _id: 'period-opening-balance',
        date: start,
        type: 'opening',
        particulars: "Opening Balance B/F",
        vehicleNumber: '-',
        volume: 0,
        rate: 0,
        credit: periodOpeningType === 'credit' ? periodOpeningBalance : 0,
        debit: periodOpeningType === 'debit' ? periodOpeningBalance : 0,
        balance: periodOpeningBalance,
        balanceType: periodOpeningType === 'credit' ? 'Cr' : 'Dr'
      };

      if (previousEntries.length > 0) {
        finalEntries = [periodOpeningEntry, ...periodEntries];
      } else {
        finalEntries = periodEntries;
      }
    }

    // The last transaction's balance (in time-asc order) is the current outstanding balance
    // Use original list for global outstanding balance update, not filtered list
    const lastEntry = entriesWithBalance.length > 0 ? entriesWithBalance[entriesWithBalance.length - 1] : null;

    const currentOutstandingBalance = lastEntry ? lastEntry.balance : (station.openingBalance || 0);
    const currentOutstandingBalanceType = lastEntry
      ? (lastEntry.balanceType === 'Cr' ? 'credit' : 'debit')
      : (station.openingBalanceType || 'credit');


    // Update station outstanding balance in DB merely for quick access (optional but good for consistency)
    if (Math.abs(currentOutstandingBalance - station.outstandingBalance) > 0.01 || currentOutstandingBalanceType !== station.outstandingBalanceType) {
      station.outstandingBalance = currentOutstandingBalance;
      station.outstandingBalanceType = currentOutstandingBalanceType;
      await station.save();
    }

    successResponse(res, "Diesel station details fetched successfully", 200, {
      station,
      ledger: finalEntries
    });
  } catch (error) {
    next(error);
  }
};
