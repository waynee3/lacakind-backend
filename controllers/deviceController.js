const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Device   = require('../models/Kiosk');
const Contract = require('../models/Contract');
const Client   = require('../models/Client');
const BulkOperation = require('../models/BulkOperation');
const { normaliseEventType, resolveEventOutcome } = require('../config/eventRules');
const { withTransaction } = require('../utils/withTransaction');
const { createError }     = require('../middleware/errorHandler');

// ─── POST /devices ────────────────────────────────────────────────────────────

const addDevice = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const data = { ...req.body };
    data.status          = data.status          || 'In Warehouse';
    data.currentLocation = data.currentLocation?.trim() || 'Main Warehouse';

    const device = await Device.create(data);
    res.status(201).json(device);
  } catch (err) {
    next(err);
  }
};

// ─── GET /devices ─────────────────────────────────────────────────────────────

const getDevices = async (req, res, next) => {
  try {
    const { serialNumber, modelType, batchNumber, status, location, clientFilter, contractFilter, page = 1, limit } = req.query;
    const query = { deletedAt: null };

    if (serialNumber)   query.serialNumber   = { $regex: serialNumber, $options: 'i' };
    if (modelType)      query.modelType      = modelType;
    if (batchNumber)    query.batchNumber    = batchNumber;
    if (status)         query.status         = status;
    if (location)       query.currentLocation = { $regex: location.trim(), $options: 'i' };

    if (clientFilter === 'No Client') {
      query.client = { $exists: false };
    } else if (clientFilter && clientFilter !== 'none') {
      if (!mongoose.Types.ObjectId.isValid(clientFilter)) return next(createError(400, 'Invalid clientId'));
      query.client = new mongoose.Types.ObjectId(clientFilter);
    }

    if (contractFilter === 'No Contract') {
      query.linkedContractIds = { $exists: true, $eq: [] };
    } else if (contractFilter) {
      const contract = await Contract.findOne({ contractId: contractFilter });
      if (!contract) return res.json([]);
      query.linkedContractIds = contract._id;
    }

    let q = Device.find(query)
      .populate({ path: 'client',           select: 'name location' })
      .populate({ path: 'linkedContractIds', select: 'contractId' });

    const limitNum = parseInt(limit);
    if (limit && !isNaN(limitNum) && limitNum > 0) {
      q = q.skip((parseInt(page) - 1) * limitNum).limit(limitNum);
    }

    const devices = await q;
    res.json(devices.map(d => ({
      ...d.toObject(),
      modelType:         d.modelType?.trim(),
      currentLocation:   d.currentLocation?.trim(),
      linkedContractIds: d.linkedContractIds.map(c => c.contractId || c._id.toString()),
    })));
  } catch (err) {
    next(err);
  }
};

// ─── GET /devices/serial/:serialNumber ───────────────────────────────────────

const getDeviceBySerialNumber = async (req, res, next) => {
  try {
    const device = await Device.findOne({ serialNumber: req.params.serialNumber, deletedAt: null }).populate('client');
    if (!device) return next(createError(404, 'Device not found'));
    res.json({ ...device.toObject(), currentLocation: device.currentLocation?.trim() });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /devices/:id ────────────────────────────────────────────────────────

const updateDevice = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (updates.currentLocation) updates.currentLocation = updates.currentLocation.trim();

    const device = await Device.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).populate('client');
    if (!device) return next(createError(404, 'Device not found'));
    res.json(device);
  } catch (err) {
    next(err);
  }
};

// ─── PUT /devices/serial/:serialNumber ───────────────────────────────────────

const updateDeviceBySerialNumber = async (req, res, next) => {
  try {
    const device = await Device.findOne({ serialNumber: req.params.serialNumber, deletedAt: null });
    if (!device) return next(createError(404, 'Device not found'));

    const updates = { ...req.body };

    // Apply lifecycle-driven status/location if a new event is being pushed
    if (Array.isArray(updates.lifecycleEvents) && updates.lifecycleEvents.length) {
      const latestEvent = updates.lifecycleEvents.at(-1);
      const actionKey   = normaliseEventType(latestEvent.eventType);
      if (actionKey) {
        const { status, location } = resolveEventOutcome(actionKey, latestEvent.associatedLocation?.trim());
        device.status          = status;
        device.currentLocation = location;
      }
    }

    if (updates.currentLocation) updates.currentLocation = updates.currentLocation.trim();
    Object.assign(device, updates);
    device.updatedAt = new Date();
    device.updatedBy = req.user?.email || req.user?.uid || 'unknown';

    await device.save();
    res.json(device);
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /devices/:id ─────────────────────────────────────────────────────

const deleteDevice = async (req, res, next) => {
  try {
    const device = await Device.findByIdAndUpdate(req.params.id, { deletedAt: new Date() });
    if (!device) return next(createError(404, 'Device not found'));
    res.json({ message: 'Device soft-deleted' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /devices/bulk-lifecycle ────────────────────────────────────────────

const bulkLogLifecycleEvent = [
  async (req, res, next) => {
    try {
      const op = req.body.bulkOperation;
      if (!op) return next(createError(400, 'Missing bulkOperation in request body'));

      const {
        bulkOpId, action, associatedLocation, affectedKiosks,
        createdBy, timestamp, description, relatedReference,
        contractId, clientId, status,
        spareCloneData, originalUpdate,
      } = op;

      if (!bulkOpId || !action || !Array.isArray(affectedKiosks) || !createdBy || !timestamp) {
        return next(createError(400, 'Missing required fields: bulkOpId, action, affectedKiosks, createdBy, timestamp'));
      }

      const actionKey = normaliseEventType(action);
      if (!actionKey) return next(createError(400, `Unknown action: ${action}`));

      const updatedKiosks = await withTransaction(async (session) => {
        // Resolve contract
        let contractIdObj = null;
        if (contractId && contractId !== 'undefined') {
          contractIdObj = mongoose.Types.ObjectId.isValid(contractId)
            ? new mongoose.Types.ObjectId(contractId)
            : (await Contract.findOne({ contractId }).session(session))?._id;
          if (!contractIdObj) throw createError(400, `Invalid contract: ${contractId}`);
        }

        // Resolve client
        let clientIdObj = null;
        if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
          clientIdObj = new mongoose.Types.ObjectId(clientId);
        } else if (spareCloneData?.client?._id && mongoose.Types.ObjectId.isValid(spareCloneData.client._id)) {
          clientIdObj = new mongoose.Types.ObjectId(spareCloneData.client._id);
        }

        // Resolve spare's linked contracts
        let linkedContractIds = [];
        if (spareCloneData?.linkedContractIds?.length) {
          for (const id of spareCloneData.linkedContractIds) {
            if (mongoose.Types.ObjectId.isValid(id)) {
              const c = await Contract.findById(id).session(session);
              if (c) linkedContractIds.push(c._id);
            } else {
              const c = await Contract.findOne({ contractId: id }).session(session);
              if (c) linkedContractIds.push(c._id);
            }
          }
        } else if (contractIdObj) {
          linkedContractIds = [contractIdObj];
        }

        // Fetch all affected kiosks
        const kiosks = await Device.find({ serialNumber: { $in: affectedKiosks }, deletedAt: null }).session(session);
        const missing = affectedKiosks.filter(sn => !kiosks.some(k => k.serialNumber === sn));
        if (missing.length) throw createError(404, `Kiosks not found: ${missing.join(', ')}`);

        const baseEvent = {
          eventType:          actionKey,
          responsibleParty:   createdBy,
          timestamp:          new Date(timestamp),
          description:        description || '',
          relatedReference:   relatedReference || '',
          associatedLocation: associatedLocation || '',
        };

        if (actionKey === 'swapdeployment' && originalUpdate && spareCloneData) {
          const origSerial  = originalUpdate.serial;
          const spareSerial = spareCloneData.serial;
          if (!affectedKiosks.includes(origSerial) || !affectedKiosks.includes(spareSerial)) {
            throw createError(400, 'Invalid serials for swapdeployment');
          }

          const origDevice  = kiosks.find(k => k.serialNumber === origSerial);
          const spareDevice = kiosks.find(k => k.serialNumber === spareSerial);

          if (origDevice) {
            await Device.updateOne(
              { _id: origDevice._id },
              {
                $set:  { status: 'Under Repair', currentLocation: 'Repair Center', client: null, linkedContractIds: [], updatedBy: createdBy, updatedAt: new Date() },
                $push: { lifecycleEvents: { ...baseEvent, associatedLocation: 'Repair Center' } },
              }
            ).session(session);
          }

          if (spareDevice) {
            const spareLoc = spareCloneData.currentLocation || associatedLocation || 'Client Site';
            await Device.updateOne(
              { _id: spareDevice._id },
              {
                $set:  { status: 'Deployed', currentLocation: spareLoc, client: clientIdObj, linkedContractIds, updatedBy: createdBy, updatedAt: new Date() },
                $push: { lifecycleEvents: { ...baseEvent, associatedLocation: spareLoc } },
              }
            ).session(session);
          }

          if (contractIdObj) {
            await Contract.updateOne({ _id: contractIdObj }, { $addToSet: { kioskSerials: spareSerial } }).session(session);
          }
        } else {
          const { status: newStatus, location: newLocation } = resolveEventOutcome(actionKey, associatedLocation);
          const finalStatus   = status || newStatus;
          const finalLocation = associatedLocation || newLocation;

          await Device.updateMany(
            { serialNumber: { $in: affectedKiosks }, deletedAt: null },
            {
              $push: { lifecycleEvents: { ...baseEvent, associatedLocation: finalLocation } },
              $set:  {
                status:          finalStatus,
                currentLocation: finalLocation,
                updatedBy:       createdBy,
                updatedAt:       new Date(),
                ...((actionKey === 'deployment' || actionKey === 'swapdeployment') && clientIdObj ? { client: clientIdObj } : { client: null }),
                linkedContractIds,
              },
            }
          ).session(session);

          if (contractIdObj && (actionKey === 'deployment' || actionKey === 'swapdeployment')) {
            await Contract.updateOne(
              { _id: contractIdObj },
              { $addToSet: { kioskSerials: { $each: affectedKiosks } } }
            ).session(session);
          }
        }

        return Device.find({ serialNumber: { $in: affectedKiosks }, deletedAt: null })
          .populate('client linkedContractIds')
          .session(session);
      });

      // Persist bulk operation record (non-fatal if it fails)
      try {
        await BulkOperation.create({
          bulkOpId, action: actionKey, affectedKiosks, createdBy,
          timestamp: new Date(timestamp), description, associatedLocation, relatedReference,
        });
      } catch (bulkOpErr) {
        console.error('Failed to save BulkOperation record:', bulkOpErr.message);
      }

      res.json({
        message:      `Bulk lifecycle event logged for ${updatedKiosks.length} kiosks`,
        bulkOpId,
        updatedKiosks: updatedKiosks.map(k => k.toObject()),
      });
    } catch (err) {
      next(err);
    }
  },
];

// ─── GET /devices/bulk-operations ────────────────────────────────────────────

const getBulkOperations = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, createdBy, startDate, endDate } = req.query;
    const query = {};

    if (action)    query.action    = action;
    if (createdBy) query.createdBy = { $regex: createdBy, $options: 'i' };
    if (startDate && endDate) {
      query.timestamp = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const skip    = (parseInt(page) - 1) * parseInt(limit);
    const [ops, total] = await Promise.all([
      BulkOperation.find(query).sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      BulkOperation.countDocuments(query),
    ]);

    res.json({ bulkOperations: ops, total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /devices/all-bulk-operations ────────────────────────────────────────

const getAllBulkOperations = async (req, res, next) => {
  try {
    const ops = await BulkOperation.find({}).sort({ timestamp: -1 }).lean();
    res.json({ bulkOperations: ops, total: ops.length });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  addDevice,
  getDevices,
  getDeviceBySerialNumber,
  updateDevice,
  updateDeviceBySerialNumber,
  bulkLogLifecycleEvent,
  getBulkOperations,
  getAllBulkOperations,
  deleteDevice,
};
