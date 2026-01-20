import express from 'express';
import archiver from 'archiver';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { BSON } from 'bson';
import { successResponse } from '../utils/responseHandler.js';
import AppError from '../utils/AppError.js';

// Import all models to backup
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Vendor from '../models/Vendor.js';
import Vehicle from '../models/Vehicle.js';
import Trip from '../models/Trip.js';
import Payment from '../models/Payment.js';
import Group from '../models/Group.js';
import Ledger from '../models/Ledger.js';
import Voucher from '../models/Voucher.js';
import IndirectSale from '../models/IndirectSale.js';
import DieselStation from '../models/DieselStation.js';

// Map of collection names to models
const models = {
    'users': User,
    'customers': Customer,
    'vendors': Vendor,
    'vehicles': Vehicle,
    'trips': Trip,
    'payments': Payment,
    'groups': Group,
    'ledgers': Ledger,
    'vouchers': Voucher,
    'indirect_sales': IndirectSale,
    'diesel_stations': DieselStation
};

// Helper to convert data to CSV
const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';
    try {
        const parser = new Parser();
        return parser.parse(data);
    } catch (err) {
        console.error('Error converting to CSV:', err);
        return '';
    }
};

// Helper to convert data to Excel buffer
const convertToExcel = (data, sheetName) => {
    if (!data || data.length === 0) return null;
    try {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    } catch (err) {
        console.error('Error converting to Excel:', err);
        return null;
    }
};

// Function to fetch all data from database
const fetchAllData = async () => {
    const data = {};
    for (const [name, model] of Object.entries(models)) {
        try {
            data[name] = await model.find({}).lean();
        } catch (err) {
            console.error(`Error fetching ${name}:`, err);
            data[name] = [];
        }
    }
    return data;
};

// Controller to handle backup download
export const downloadBackup = async (req, res, next) => {
    try {
        const { format = 'json' } = req.query; // json, csv, or excel
        const data = await fetchAllData();

        // Create archive
        const archive = archiver('zip', {
            zlib: { level: 9 } // Sets the compression level
        });

        // Set response headers
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `db_backup_${timestamp}.zip`;

        res.attachment(filename);

        // Pipe archive data to the response
        archive.pipe(res);

        // Add files to archive based on format
        if (format === 'json') {
            for (const [name, collectionData] of Object.entries(data)) {
                archive.append(JSON.stringify(collectionData, null, 2), { name: `${name}.json` });
            }
        } else if (format === 'csv') {
            for (const [name, collectionData] of Object.entries(data)) {
                const csvData = convertToCSV(collectionData);
                archive.append(csvData, { name: `${name}.csv` });
            }
        } else if (format === 'excel') {
            // For Excel, we can either create one big workbook or individual files
            // Given the zip requirement, let's create individual xlsx files for consistency with other formats
            // Or ideally, one workbook if the user requested excel but we are returning zip? 
            // The prompt says "download database backup in selected formate in csv, json, xcel by clicking db backup zip is download"
            // So we zip the result regardless.

            if (buffer) {
                archive.append(buffer, { name: `${name}.xlsx` });
            }
        } else if (format === 'bson') {
            for (const [name, collectionData] of Object.entries(data)) {
                // Serialize collection data to BSON
                // We wrap the array in an object or just serialize the array directly? 
                // Typically BSON is document-based. We can serialize the array of docs.
                try {
                    const buffer = BSON.serialize({ data: collectionData });
                    archive.append(buffer, { name: `${name}.bson` });
                } catch (err) {
                    console.error(`Error serializing ${name} to BSON:`, err);
                }
            }
        } else {
            throw new AppError('Invalid format selected', 400);
        }

        // Finalize the archive (ie we are done appending files but streams have to finish yet)
        await archive.finalize();

    } catch (error) {
        console.error('Backup error:', error);
        // If headers sent, we can't send error response
        if (!res.headersSent) {
            next(error);
        }
    }
};
