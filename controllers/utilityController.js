import { readFileSync, writeFileSync, unlinkSync, existsSync, createReadStream } from "fs";
import { Types } from "mongoose";
import multer from "multer";
import csv from "csv-parser";
import Device, { DEVICE_STATUSES } from "../models/Device.js";
import Client from "../models/Client.js";
import BulkOperation from "../models/BulkOperation.js";
import { withTransaction } from "../utils/withTransaction.js";
import { createError } from "../middleware/errorHandler.js";

const upload = multer({ dest: "uploads/" });

const escapeForRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HEADER_ALIASES = {
  serialNumber: ["serialnumber", "serial_number"],
  modelType: ["modeltype", "model_type"],
  currentLocation: ["currentlocation", "current_location"],
  purchaseDate: ["purchasedate", "purchase_date"],
  activationDate: ["activationdate", "activation_date"],
  batchNumber: ["batchnumber", "batch_number"],
  supplier: ["supplier"],
  cost: ["cost"],
  warrantyExpiry: ["warrantyexpiry", "warranty_expiry"],
  status: ["status"],
  client: ["client"],
};

const STATUS_ALIASES = {
  active: "Deployed",
  inactive: "In Warehouse",
  instock: "InStock",
  "in stock": "InStock",
  inwarehouse: "In Warehouse",
  warehouse: "In Warehouse",
  underrepair: "Under Repair",
  under_repair: "Under Repair",
  "in repair": "Under Repair",
  repair: "Under Repair",
  sparedeployed: "Spare Deployed",
  spare_deployed: "Spare Deployed",
};

function resolveStatus(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (DEVICE_STATUSES.includes(trimmed)) return trimmed;
  const lowerTrimmed = trimmed.toLowerCase();
  const exactCI = DEVICE_STATUSES.find((s) => s.toLowerCase() === lowerTrimmed);
  if (exactCI) return exactCI;
  return STATUS_ALIASES[lowerTrimmed] ?? null;
}

function mapHeader(raw) {
  const normalised = raw.trim().toLowerCase().replace(/\s+/g, "");
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalised) || normalised === key.toLowerCase()) return key;
  }
  return raw;
}

const bulkImport = [
  upload.single("csvFile"),
  async (req, res, next) => {
    if (!req.file) return next(createError(400, "No file uploaded"));

    const owner = req.user.id;
    const filePath = req.file.path;

    try {
      let content = readFileSync(filePath, "utf8");
      content = content.replace(/;+(\r?\n|$)/g, "$1");
      content = content
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .join("\n");
      content = content.replace(/ SN/g, "\nSN");
      writeFileSync(filePath, content);

      const { rows, parseErrors } = await parseCSV(filePath);

      const devices = [];
      const rowErrors = [...parseErrors];
      let rowNumber = 0;

      for (const row of rows) {
        rowNumber++;

        const missing = ["serialNumber", "modelType", "currentLocation"].filter((f) => !row[f]);
        if (missing.length) {
          rowErrors.push(`Row ${rowNumber}: Missing ${missing.join(", ")}`);
          continue;
        }

        // Duplicate check is PER OWNER now
        const duplicate = await Device.findOne({
          owner,
          serialNumber: { $regex: `^${escapeForRegex(row.serialNumber)}$`, $options: "i" },
          deletedAt: null,
        });
        if (duplicate) {
          rowErrors.push(`Row ${rowNumber}: Serial ${row.serialNumber} already exists`);
          continue;
        }

        let normalizedStatus = "In Warehouse";
        if (row.status) {
          const resolved = resolveStatus(row.status);
          if (!resolved) {
            rowErrors.push(
              `Row ${rowNumber}: Invalid status "${row.status}". Must be one of: ${DEVICE_STATUSES.join(", ")} (or aliases: Active → Deployed, Inactive → In Warehouse)`,
            );
            continue;
          }
          normalizedStatus = resolved;
        }

        const parsedDates = {};
        for (const field of ["purchaseDate", "activationDate", "warrantyExpiry"]) {
          if (row[field]) {
            const d = new Date(row[field]);
            if (isNaN(d.getTime())) {
              rowErrors.push(`Row ${rowNumber}: Invalid date for ${field}: "${row[field]}"`);
            } else {
              parsedDates[field] = d;
            }
          }
        }

        const isDeployed = normalizedStatus === "Deployed" || normalizedStatus === "Spare Deployed";

        let clientId = null;
        if (isDeployed && row.currentLocation) {
          const clientName = row.currentLocation.trim();
          let client = await Client.findOne({
            owner,
            name: { $regex: `^${escapeForRegex(clientName)}$`, $options: "i" },
          });
          if (!client) {
            try {
              client = await Client.create({ owner, name: clientName, location: clientName });
            } catch (e) {
              if (e.code === 11000) {
                client = await Client.findOne({
                  owner,
                  name: { $regex: `^${escapeForRegex(clientName)}$`, $options: "i" },
                });
              } else {
                rowErrors.push(`Row ${rowNumber}: Failed to create client "${clientName}": ${e.message}`);
                continue;
              }
            }
          }
          clientId = client?._id ?? null;
        }

        devices.push({
          owner,
          serialNumber: row.serialNumber,
          modelType: row.modelType,
          currentLocation: row.currentLocation,
          client: clientId,
          status: normalizedStatus,
          batchNumber: row.batchNumber || "N/A",
          supplier: row.supplier || "Unknown",
          cost: row.cost ? parseFloat(row.cost) : 0,
          ...parsedDates,
          createdBy: req.user?.email || "N/A",
          updatedBy: req.user?.email || "N/A",
          lifecycleEvents: [
            {
              eventType: "procurementarrival",
              timestamp: new Date(),
              description: "Initial procurement via bulk import",
              associatedLocation: row.currentLocation || "Main Warehouse",
              responsibleParty: req.user?.email || "anonymous",
              relatedReference: row.serialNumber,
            },
          ],
        });
      }

      if (!devices.length) {
        unlinkSync(filePath);
        return res.status(400).json({ errors: rowErrors });
      }

      const inserted = await withTransaction(async (session) => {
        return Device.insertMany(devices, { session });
      });

      unlinkSync(filePath);

      try {
        await BulkOperation.create({
          owner,
          bulkOpId: `import-${Date.now()}`,
          action: "bulk_import",
          affectedDevices: inserted.map((d) => d.serialNumber),
          createdBy: req.user?.email || "anonymous",
          timestamp: new Date(),
          totalRecords: rows.length,
          successfulRecords: inserted.length,
          failedRecords: rowErrors.length,
          importErrors: rowErrors,
        });
      } catch (e) {
        console.error("Failed to save BulkOperation for import:", e.message);
      }

      res.json({
        message: "Bulk import completed",
        totalRecords: rows.length,
        successfulRecords: inserted.length,
        failedRecords: rowErrors.length,
        errors: rowErrors.length ? rowErrors : null,
      });
    } catch (err) {
      if (existsSync(filePath)) unlinkSync(filePath);
      next(err);
    }
  },
];

const bulkUpdate = async (req, res, next) => {
  try {
    const { deviceIds, updates } = req.body;
    const owner = req.user.id;

    if (!Array.isArray(deviceIds) || !deviceIds.length)
      return next(createError(400, "deviceIds must be a non-empty array"));
    if (!updates || !Object.keys(updates).length) return next(createError(400, "updates must be a non-empty object"));

    const invalidIds = deviceIds.filter((id) => !Types.ObjectId.isValid(id));
    if (invalidIds.length) return next(createError(400, `Invalid device IDs: ${invalidIds.join(", ")}`));

    delete updates.owner; // never let caller re-assign ownership
    const result = await Device.updateMany(
      { owner, _id: { $in: deviceIds } },
      { ...updates, updatedAt: new Date(), updatedBy: req.user.email },
    );

    res.json({
      message: "Bulk update successful",
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
};

const generateReports = async (req, res, next) => {
  try {
    const { type, startDate, endDate } = req.query;
    if (type !== "maintenance") return next(createError(400, `Unsupported report type: ${type}`));

    const devices = await Device.find({
      owner: req.user.id,
      "lifecycleEvents.eventType": "maintenancestart",
      "lifecycleEvents.timestamp": { $gte: new Date(startDate), $lte: new Date(endDate) },
    });

    res.json(
      devices.map((d) => ({
        serialNumber: d.serialNumber,
        repairs: d.lifecycleEvents.filter((e) => e.eventType === "maintenancestart"),
      })),
    );
  } catch (err) {
    next(err);
  }
};

const getBulkOperations = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, createdBy, startDate, endDate } = req.query;
    const query = { owner: req.user.id };

    if (action) query.action = action;
    if (createdBy) query.createdBy = { $regex: createdBy, $options: "i" };
    if (startDate && endDate) query.timestamp = { $gte: new Date(startDate), $lte: new Date(endDate) };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [ops, total] = await Promise.all([
      BulkOperation.find(query).sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      BulkOperation.countDocuments(query),
    ]);

    res.json({
      bulkOperations: ops,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    });
  } catch (err) {
    next(err);
  }
};

function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const errors = [];

    const parser = csv({
      mapHeaders: ({ header }) => mapHeader(header),
      mapValues: ({ value }) => (typeof value === "string" ? value.trim() || null : value),
      strict: false,
    });

    parser.on("headers", (headers) => {
      const required = ["serialNumber", "modelType", "currentLocation"];
      const missing = required.filter((h) => !headers.includes(h));
      if (missing.length) return reject(new Error(`Missing required CSV headers: ${missing.join(", ")}`));
    });

    parser.on("data", (row) => {
      if (Object.values(row).every((v) => v == null || v === "")) {
        errors.push("Skipped empty row");
        return;
      }
      rows.push(row);
    });

    parser.on("end", () => resolve({ rows, parseErrors: errors }));
    parser.on("error", reject);

    createReadStream(filePath).pipe(parser);
  });
}

export { bulkImport, bulkUpdate, generateReports, getBulkOperations };
