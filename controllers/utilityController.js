import { readFileSync, writeFileSync, unlinkSync, existsSync, createReadStream } from 'fs';
import { Types } from 'mongoose';
import multer from 'multer';
import csv from 'csv-parser';
import { findOne, insertMany, updateMany, find } from '../models/Kiosk';
import { findOne as _findOne } from '../models/Client';
import { create, find as _find, countDocuments } from '../models/BulkOperation';
import { withTransaction } from '../utils/withTransaction';
const { createError }     = require('../middleware/errorHandler').default;

const upload = multer({ dest: 'uploads/' });

const VALID_STATUSES = ['In Warehouse', 'Deployed', 'Under Repair', 'Repaired', 'Spare Deployed', 'Returned', 'Retired'];

const HEADER_ALIASES = {
  serialNumber:    ['serialnumber', 'serial_number'],
  modelType:       ['modeltype', 'model_type'],
  currentLocation: ['currentlocation', 'current_location'],
  purchaseDate:    ['purchasedate', 'purchase_date'],
  activationDate:  ['activationdate', 'activation_date'],
  batchNumber:     ['batchnumber', 'batch_number'],
  supplier:        ['supplier'],
  cost:            ['cost'],
  warrantyExpiry:  ['warrantyexpiry', 'warranty_expiry'],
  status:          ['status'],
  client:          ['client'],
};

function mapHeader(raw) {
  const normalised = raw.trim().toLowerCase().replace(/\s+/g, '');
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalised) || normalised === key.toLowerCase()) return key;
  }
  return raw; // unmapped header — pass through
}

// ─── POST /utilities/bulk-import ─────────────────────────────────────────────

const bulkImport = [
  upload.single('csvFile'),
  async (req, res, next) => {
    if (!req.file) return next(createError(400, 'No file uploaded'));

    const filePath = req.file.path;

    try {
      // Pre-clean the CSV
      let content = readFileSync(filePath, 'utf8');
      content = content.replace(/;+(\r?\n|$)/g, '$1');
      content = content.split(/\r?\n/).filter(l => l.trim()).join('\n');
      content = content.replace(/ SN/g, '\nSN');
      writeFileSync(filePath, content);

      // Parse CSV into memory first — safe to do async resolution after
      const { rows, parseErrors } = await parseCSV(filePath);

      // Validate & enrich rows
      const devices    = [];
      const rowErrors  = [...parseErrors];
      let   rowNumber  = 0;

      for (const row of rows) {
        rowNumber++;

        const missing = ['serialNumber', 'modelType', 'currentLocation'].filter(f => !row[f]);
        if (missing.length) { rowErrors.push(`Row ${rowNumber}: Missing ${missing.join(', ')}`); continue; }

        const duplicate = await findOne({ serialNumber: { $regex: `^${row.serialNumber}$`, $options: 'i' }, deletedAt: null });
        if (duplicate) { rowErrors.push(`Row ${rowNumber}: Serial ${row.serialNumber} already exists`); continue; }

        let clientId = null;
        if (row.client && row.client !== 'N/A') {
          const client = await _findOne({ name: row.client });
          if (!client) { rowErrors.push(`Row ${rowNumber}: Client "${row.client}" not found`); continue; }
          clientId = client._id;
        }

        let parsedDates = {};
        let dateError   = false;
        for (const field of ['purchaseDate', 'activationDate', 'warrantyExpiry']) {
          if (row[field]) {
            const d = new Date(row[field]);
            if (isNaN(d.getTime())) { rowErrors.push(`Row ${rowNumber}: Invalid ${field}`); dateError = true; break; }
            parsedDates[field] = d;
          }
        }
        if (dateError) continue;

        if (row.cost && isNaN(parseFloat(row.cost))) {
          rowErrors.push(`Row ${rowNumber}: Invalid cost`); continue;
        }

        let normalizedStatus = 'In Warehouse';
        if (row.status) {
          const trimmed = row.status.trim();
          const match   = VALID_STATUSES.find(s => s.toLowerCase() === trimmed.toLowerCase());
          if (!match) { rowErrors.push(`Row ${rowNumber}: Invalid status "${row.status}"`); continue; }
          normalizedStatus = match;
        }

        devices.push({
          serialNumber:    row.serialNumber,
          modelType:       row.modelType,
          currentLocation: row.currentLocation,
          client:          clientId,
          status:          normalizedStatus,
          batchNumber:     row.batchNumber || 'N/A',
          supplier:        row.supplier    || 'Unknown',
          cost:            row.cost ? parseFloat(row.cost) : 0,
          ...parsedDates,
          createdBy:  req.user?.uid || 'N/A',
          updatedBy:  req.user?.uid || 'N/A',
          lifecycleEvents: [{
            eventType:          'procurementarrival',
            timestamp:          new Date(),
            description:        'Initial procurement via bulk import',
            associatedLocation: row.currentLocation || 'Main Warehouse',
            responsibleParty:   req.user?.uid || 'anonymous',
            relatedReference:   row.serialNumber,
          }],
        });
      }

      if (!devices.length) {
        unlinkSync(filePath);
        return res.status(400).json({ errors: rowErrors });
      }

      // Now safe to use a transaction — all async work is done
      const inserted = await withTransaction(async (session) => {
        return insertMany(devices, { session });
      });

      unlinkSync(filePath);

      // Save audit record
      try {
        await create({
          bulkOpId:         `import-${Date.now()}`,
          action:           'bulk_import',
          affectedKiosks:   inserted.map(d => d.serialNumber),
          createdBy:        req.user?.uid || 'anonymous',
          timestamp:        new Date(),
          totalRecords:     rows.length,
          successfulRecords:inserted.length,
          failedRecords:    rowErrors.length,
          importErrors:     rowErrors,
        });
      } catch (e) {
        console.error('Failed to save BulkOperation for import:', e.message);
      }

      res.json({
        message:          'Bulk import completed',
        totalRecords:     rows.length,
        successfulRecords:inserted.length,
        failedRecords:    rowErrors.length,
        errors:           rowErrors.length ? rowErrors : null,
      });
    } catch (err) {
      if (existsSync(filePath)) unlinkSync(filePath);
      next(err);
    }
  },
];

// ─── POST /utilities/bulk-update ──────────────────────────────────────────────

const bulkUpdate = async (req, res, next) => {
  try {
    const { deviceIds, updates } = req.body;

    if (!Array.isArray(deviceIds) || !deviceIds.length) return next(createError(400, 'deviceIds must be a non-empty array'));
    if (!updates || !Object.keys(updates).length)       return next(createError(400, 'updates must be a non-empty object'));

    const invalidIds = deviceIds.filter(id => !Types.ObjectId.isValid(id));
    if (invalidIds.length) return next(createError(400, `Invalid device IDs: ${invalidIds.join(', ')}`));

    const result = await updateMany(
      { _id: { $in: deviceIds } },
      { ...updates, updatedAt: new Date(), updatedBy: req.user.uid }
    );

    res.json({ message: 'Bulk update successful', matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
};

// ─── GET /utilities/reports ───────────────────────────────────────────────────

const generateReports = async (req, res, next) => {
  try {
    const { type, startDate, endDate } = req.query;
    if (type !== 'maintenance') return next(createError(400, `Unsupported report type: ${type}`));

    const devices = await find({
      'lifecycleEvents.eventType':   'maintenancestart',
      'lifecycleEvents.timestamp':   { $gte: new Date(startDate), $lte: new Date(endDate) },
    });

    res.json(devices.map(d => ({
      serialNumber: d.serialNumber,
      repairs:      d.lifecycleEvents.filter(e => e.eventType === 'maintenancestart'),
    })));
  } catch (err) {
    next(err);
  }
};

// ─── GET /utilities/bulk-operations ──────────────────────────────────────────

const getBulkOperations = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, createdBy, startDate, endDate } = req.query;
    const query = {};
    if (action)    query.action    = action;
    if (createdBy) query.createdBy = { $regex: createdBy, $options: 'i' };
    if (startDate && endDate) query.timestamp = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const [ops, total] = await Promise.all([
      _find(query).sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      countDocuments(query),
    ]);

    res.json({ bulkOperations: ops, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows   = [];
    const errors = [];

    const parser = csv({
      mapHeaders: ({ header }) => mapHeader(header),
      mapValues:  ({ value })  => (typeof value === 'string' ? (value.trim() || null) : value),
      strict:     false,
    });

    parser.on('headers', (headers) => {
      const required = ['serialNumber', 'modelType', 'currentLocation'];
      const missing  = required.filter(h => !headers.includes(h));
      if (missing.length) return reject(new Error(`Missing required CSV headers: ${missing.join(', ')}`));
    });

    parser.on('data',  row => {
      if (Object.values(row).every(v => v == null || v === '')) {
        errors.push('Skipped empty row');
        return;
      }
      rows.push(row);
    });

    parser.on('end',   () => resolve({ rows, parseErrors: errors }));
    parser.on('error', reject);

    createReadStream(filePath).pipe(parser);
  });
}

export default { bulkImport, bulkUpdate, generateReports, getBulkOperations };
