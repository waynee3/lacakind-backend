import { Types } from 'mongoose';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import Device, { DEVICE_STATUSES } from '../models/Device.js';
import Client from '../models/Client.js';
import BulkOperation from '../models/BulkOperation.js';
import { withTransaction } from '../utils/withTransaction.js';
import { createError } from '../middleware/errorHandler.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' ||
        file.mimetype === 'application/csv' ||
        file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

const escapeForRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const HEADER_ALIASES = {
  serialNumber:    ['serialnumber', 'serial_number', 'sn'],
  modelType:       ['modeltype', 'model_type', 'model'],
  currentLocation: ['currentlocation', 'current_location', 'location'],
  purchaseDate:    ['purchasedate', 'purchase_date'],
  activationDate:  ['activationdate', 'activation_date'],
  batchNumber:     ['batchnumber', 'batch_number', 'batch'],
  supplier:        ['supplier'],
  cost:            ['cost', 'price'],
  warrantyExpiry:  ['warrantyexpiry', 'warranty_expiry', 'warranty'],
  status:          ['status'],
  client:          ['client', 'clientname', 'client_name'],
};

const STATUS_ALIASES = {
  'active':         'Deployed',
  'inactive':       'In Warehouse',
  'instock':        'InStock',
  'in stock':       'InStock',
  'inwarehouse':    'In Warehouse',
  'warehouse':      'In Warehouse',
  'underrepair':    'Under Repair',
  'under_repair':   'Under Repair',
  'in repair':      'Under Repair',
  'repair':         'Under Repair',
  'sparedeployed':  'Spare Deployed',
  'spare_deployed': 'Spare Deployed',
};

function resolveStatus(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (DEVICE_STATUSES.includes(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  const exactCI = DEVICE_STATUSES.find(s => s.toLowerCase() === lower);
  if (exactCI) return exactCI;
  return STATUS_ALIASES[lower] ?? null;
}

function mapHeader(raw) {
  const normalised = raw.trim().toLowerCase().replace(/\s+/g, '');
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalised) || normalised === key.toLowerCase()) return key;
  }
  return raw;
}

const bulkImport = [
  upload.single('csvFile'),
  async (req, res, next) => {
    if (!req.file) return next(createError(400, 'No file uploaded'));

    const owner = req.user.id;

    try {
      let content = req.file.buffer.toString('utf8');
      content = content.replace(/\uFEFF/, '');        
      content = content.replace(/;+(\r?\n|$)/g, '$1'); 
      content = content.split(/\r?\n/).filter(l => l.trim()).join('\n');

      const { rows, parseErrors } = await parseCSVFromString(content);

      const existingClients = await Client.find({ owner }, 'name location').lean();
      const clientCache = new Map(
        existingClients.map(c => [c.name.toLowerCase().trim(), c])
      );

      const existingSerials = new Set(
        (await Device.find({ owner, deletedAt: null }, 'serialNumber').lean())
          .map(d => d.serialNumber.toLowerCase())
      );

      const devices    = [];
      const rowErrors  = [...parseErrors];
      const newClients = []; 
      let rowNumber    = 0;

      for (const row of rows) {
        rowNumber++;

        const missing = ['serialNumber', 'modelType', 'currentLocation'].filter(f => !row[f]);
        if (missing.length) {
          rowErrors.push(`Row ${rowNumber}: Missing ${missing.join(', ')}`);
          continue;
        }

        if (existingSerials.has(row.serialNumber.toLowerCase())) {
          rowErrors.push(`Row ${rowNumber}: Serial ${row.serialNumber} already exists`);
          continue;
        }
        existingSerials.add(row.serialNumber.toLowerCase()); 

        let normalizedStatus = 'In Warehouse';
        if (row.status) {
          const resolved = resolveStatus(row.status);
          if (!resolved) {
            rowErrors.push(
              `Row ${rowNumber}: Invalid status "${row.status}". Valid: ${DEVICE_STATUSES.join(', ')}`
            );
            continue;
          }
          normalizedStatus = resolved;
        }

        const parsedDates = {};
        for (const field of ['purchaseDate', 'activationDate', 'warrantyExpiry']) {
          if (row[field]) {
            const d = new Date(row[field]);
            if (!isNaN(d.getTime())) parsedDates[field] = d;
            else rowErrors.push(`Row ${rowNumber}: Invalid date for ${field}: "${row[field]}"`);
          }
        }

        const isDeployed = normalizedStatus === 'Deployed' || normalizedStatus === 'Spare Deployed';
        let clientId = null;

        if (isDeployed && row.currentLocation) {
          const key = row.currentLocation.trim().toLowerCase();
          let cached = clientCache.get(key);

          if (!cached) {
            const newClient = {
              _id:      new Types.ObjectId(),
              owner:    new Types.ObjectId(owner),
              name:     row.currentLocation.trim(),
              location: row.currentLocation.trim(),
              contactPerson: '',
              email:    '',
              phone:    '',
              address:  '',
            };
            newClients.push(newClient);
            clientCache.set(key, newClient);
            cached = newClient;
          }

          clientId = cached._id;
        }

        devices.push({
          owner,
          serialNumber:    row.serialNumber.trim(),
          modelType:       row.modelType?.trim(),
          currentLocation: row.currentLocation?.trim(),
          client:          clientId,
          status:          normalizedStatus,
          batchNumber:     row.batchNumber || 'N/A',
          supplier:        row.supplier    || 'Unknown',
          cost:            row.cost ? parseFloat(row.cost) : 0,
          ...parsedDates,
          createdBy: req.user?.email || 'N/A',
          updatedBy: req.user?.email || 'N/A',
          lifecycleEvents: [{
            eventType:          'procurementarrival',
            timestamp:          new Date(),
            description:        'Initial procurement via bulk import',
            associatedLocation: row.currentLocation || 'Main Warehouse',
            responsibleParty:   req.user?.email || 'anonymous',
            relatedReference:   row.serialNumber,
          }],
        });
      }

      if (!devices.length) {
        return res.status(400).json({ errors: rowErrors });
      }

      const inserted = await withTransaction(async (session) => {
        if (newClients.length) {
          await Client.insertMany(newClients, { session, ordered: false })
            .catch(err => {
              if (err.code !== 11000 && err.writeErrors?.every(e => e.code === 11000) === false) {
                throw err;
              }
            });
        }
        return Device.insertMany(devices, { session, ordered: false });
      });

      try {
        await BulkOperation.create({
          owner,
          bulkOpId:          `import-${Date.now()}`,
          action:            'bulk_import',
          affectedDevices:   inserted.map(d => d.serialNumber),
          createdBy:         req.user?.email || 'anonymous',
          timestamp:         new Date(),
          totalRecords:      rows.length,
          successfulRecords: inserted.length,
          failedRecords:     rowErrors.length,
          importErrors:      rowErrors,
        });
      } catch (e) {
        console.error('Failed to save BulkOperation for import:', e.message);
      }

      res.json({
        message:           'Bulk import completed',
        totalRecords:      rows.length,
        successfulRecords: inserted.length,
        failedRecords:     rowErrors.length,
        errors:            rowErrors.length ? rowErrors : null,
      });
    } catch (err) {
      next(err);
    }
  },
];

const bulkUpdate = async (req, res, next) => {
  try {
    const { deviceIds, updates } = req.body;
    const owner = req.user.id;

    if (!Array.isArray(deviceIds) || !deviceIds.length)
      return next(createError(400, 'deviceIds must be a non-empty array'));
    if (!updates || !Object.keys(updates).length)
      return next(createError(400, 'updates must be a non-empty object'));

    const invalidIds = deviceIds.filter(id => !Types.ObjectId.isValid(id));
    if (invalidIds.length)
      return next(createError(400, `Invalid device IDs: ${invalidIds.join(', ')}`));

    delete updates.owner;
    const result = await Device.updateMany(
      { owner, _id: { $in: deviceIds } },
      { ...updates, updatedAt: new Date(), updatedBy: req.user.email },
    );

    res.json({ message: 'Bulk update successful', matchedCount: result.matchedCount, modifiedCount: result.modifiedCount });
  } catch (err) {
    next(err);
  }
};

const generateReports = async (req, res, next) => {
  try {
    const { type, startDate, endDate } = req.query;
    if (type !== 'maintenance')
      return next(createError(400, `Unsupported report type: ${type}`));

    const devices = await Device.find({
      owner: req.user.id,
      'lifecycleEvents.eventType': 'maintenancestart',
      'lifecycleEvents.timestamp': { $gte: new Date(startDate), $lte: new Date(endDate) },
    });

    res.json(devices.map(d => ({
      serialNumber: d.serialNumber,
      repairs:      d.lifecycleEvents.filter(e => e.eventType === 'maintenancestart'),
    })));
  } catch (err) {
    next(err);
  }
};

const getBulkOperations = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, action, createdBy, startDate, endDate } = req.query;
    const owner = req.user.id;
    const query = { owner };

    if (action)    query.action    = action;
    if (createdBy) query.createdBy = { $regex: createdBy, $options: 'i' };
    if (startDate && endDate) query.timestamp = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [ops, total] = await Promise.all([
      BulkOperation.find(query).sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      BulkOperation.countDocuments(query),
    ]);

    res.json({ bulkOperations: ops, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
};

function parseCSVFromString(csvString) {
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

    parser.on('data', row => {
      if (Object.values(row).every(v => v == null || v === '')) return;
      rows.push(row);
    });

    parser.on('end',   () => resolve({ rows, parseErrors: errors }));
    parser.on('error', reject);

    Readable.from([csvString]).pipe(parser);
  });
}

export { bulkImport, bulkUpdate, generateReports, getBulkOperations };