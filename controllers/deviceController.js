const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
import { Types } from "mongoose";
import { validationResult } from "express-validator";
import Device from "../models/Device.js";
import Contract from "../models/Contract.js";
import BulkOperation from "../models/BulkOperation.js";
import { normaliseEventType, resolveEventOutcome } from "../config/eventRules.js";
import { withTransaction } from "../utils/withTransaction.js";
import { createError } from "../middleware/errorHandler.js";

const addDevice = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const data = { ...req.body, owner: req.user.id };
    data.status = data.status || "In Warehouse";
    data.currentLocation = data.currentLocation?.trim() || "Main Warehouse";

    const device = await Device.create(data);
    res.status(201).json(device);
  } catch (err) {
    next(err);
  }
};

const getDevices = async (req, res, next) => {
  try {
    const {
      serialNumber,
      modelType,
      batchNumber,
      status,
      location,
      clientFilter,
      contractFilter,
      page = 1,
      limit,
    } = req.query;

    const query = { owner: req.user.id, deletedAt: null };

    if (serialNumber) query.serialNumber = { $regex: escapeRegex(serialNumber), $options: "i" };
    if (modelType) query.modelType = modelType;
    if (batchNumber) query.batchNumber = batchNumber;
    if (status) query.status = status;
    if (location) query.currentLocation = { $regex: escapeRegex(location), $options: "i" };

    if (clientFilter === "No Client") {
      query.client = { $exists: false };
    } else if (clientFilter && clientFilter !== "none") {
      if (!Types.ObjectId.isValid(clientFilter)) return next(createError(400, "Invalid clientId"));
      query.client = new Types.ObjectId(clientFilter);
    }

    if (contractFilter === "No Contract") {
      query.linkedContractIds = { $exists: true, $eq: [] };
    } else if (contractFilter) {
      const contract = await Contract.findOne({ owner: req.user.id, contractId: contractFilter });
      if (!contract) return res.json([]);
      query.linkedContractIds = contract._id;
    }

    let q = Device.find(query)
      .populate({ path: "client", select: "name location" })
      .populate({ path: "linkedContractIds", select: "contractId" });

    const limitNum = parseInt(limit);
    if (limit && !isNaN(limitNum) && limitNum > 0) {
      q = q.skip((parseInt(page) - 1) * limitNum).limit(limitNum);
    }

    const devices = await q;
    res.json(
      devices.map((d) => ({
        ...d.toJSON(),
        modelType: d.modelType?.trim(),
        currentLocation: d.currentLocation?.trim(),
        linkedContractIds: d.linkedContractIds.map((c) => c.contractId || c._id.toString()),
      })),
    );
  } catch (err) {
    next(err);
  }
};

const getDeviceBySerialNumber = async (req, res, next) => {
  try {
    const device = await Device.findOne({
      owner: req.user.id,
      serialNumber: req.params.serialNumber,
      deletedAt: null,
    }).populate("client");
    if (!device) return next(createError(404, "Device not found"));
    res.json({ ...device.toJSON(), currentLocation: device.currentLocation?.trim() });
  } catch (err) {
    next(err);
  }
};

const updateDevice = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    delete updates.owner; 
    if (updates.currentLocation) updates.currentLocation = updates.currentLocation.trim();

    const device = await Device.findOneAndUpdate(
      { owner: req.user.id, _id: req.params.id },
      updates,
      { new: true, runValidators: true },
    ).populate("client");
    if (!device) return next(createError(404, "Device not found"));
    res.json(device);
  } catch (err) {
    next(err);
  }
};

const updateDeviceBySerialNumber = async (req, res, next) => {
  try {
    const device = await Device.findOne({
      owner: req.user.id,
      serialNumber: req.params.serialNumber,
      deletedAt: null,
    });
    if (!device) return next(createError(404, "Device not found"));

    const updates = { ...req.body };
    delete updates.owner;

    if (Array.isArray(updates.lifecycleEvents) && updates.lifecycleEvents.length) {
      const latestEvent = updates.lifecycleEvents.at(-1);
      const actionKey = normaliseEventType(latestEvent.eventType);
      if (actionKey) {
        const { status, location } = resolveEventOutcome(actionKey, latestEvent.associatedLocation?.trim());
        device.status = status;
        device.currentLocation = location;
      }
    }

    if (updates.currentLocation) updates.currentLocation = updates.currentLocation.trim();
    Object.assign(device, updates);
    device.updatedAt = new Date();
    device.updatedBy = req.user?.email || "unknown";

    await device.save();
    res.json(device);
  } catch (err) {
    next(err);
  }
};

const deleteDevice = async (req, res, next) => {
  try {
    const device = await Device.findOneAndUpdate(
      { owner: req.user.id, _id: req.params.id },
      { deletedAt: new Date() },
    );
    if (!device) return next(createError(404, "Device not found"));
    res.json({ message: "Device soft-deleted" });
  } catch (err) {
    next(err);
  }
};

const bulkLogLifecycleEvent = [
  async (req, res, next) => {
    try {
      const op = req.body.bulkOperation;
      if (!op) return next(createError(400, "Missing bulkOperation in request body"));

      const {
        bulkOpId,
        action,
        associatedLocation,
        affectedDevices,
        createdBy,
        timestamp,
        description,
        relatedReference,
        contractId,
        clientId,
        status,
        spareCloneData,
        originalUpdate,
      } = op;

      if (!bulkOpId || !action || !Array.isArray(affectedDevices) || !createdBy || !timestamp) {
        return next(
          createError(400, "Missing required fields: bulkOpId, action, affectedDevices, createdBy, timestamp"),
        );
      }

      const actionKey = normaliseEventType(action);
      if (!actionKey) return next(createError(400, `Unknown action: ${action}`));

      const owner = req.user.id;

      const updatedDevices = await withTransaction(async (session) => {
        let contractIdObj = null;
        if (contractId && contractId !== "undefined") {
          contractIdObj = Types.ObjectId.isValid(contractId) ? new Types.ObjectId(contractId) : null;
        }
        let clientIdObj = null;
        if (clientId && clientId !== "undefined") {
          clientIdObj = Types.ObjectId.isValid(clientId) ? new Types.ObjectId(clientId) : null;
        }
        const linkedContractIds = contractIdObj ? [contractIdObj] : [];

        const baseEvent = {
          eventType: actionKey,
          timestamp: new Date(timestamp),
          description,
          responsibleParty: createdBy,
          relatedReference,
        };

        if (actionKey === "swapdeployment" && spareCloneData) {
          const spareSerial = spareCloneData.serialNumber;
          const spareLoc = associatedLocation || spareCloneData.currentLocation || "Client Site";

          if (originalUpdate) {
            await Device.updateMany(
              { owner, serialNumber: { $in: affectedDevices }, deletedAt: null },
              {
                $push: { lifecycleEvents: { ...baseEvent, associatedLocation: spareLoc } },
                $set: {
                  status: originalUpdate.status || "Returned",
                  currentLocation: originalUpdate.currentLocation || "Main Warehouse",
                  updatedBy: createdBy,
                  updatedAt: new Date(),
                },
              },
            ).session(session);
          }

          const spareDevice = await Device.findOne({ owner, serialNumber: spareSerial, deletedAt: null }).session(
            session,
          );
          if (spareDevice) {
            await Device.updateOne(
              { owner, _id: spareDevice._id },
              {
                $set: {
                  status: "Spare Deployed",
                  currentLocation: spareLoc,
                  client: clientIdObj,
                  linkedContractIds,
                  updatedBy: createdBy,
                  updatedAt: new Date(),
                },
                $push: { lifecycleEvents: { ...baseEvent, associatedLocation: spareLoc } },
              },
            ).session(session);
          }

          if (contractIdObj) {
            await Contract.updateOne(
              { owner, _id: contractIdObj },
              { $addToSet: { deviceSerials: spareSerial } },
            ).session(session);
          }
        } else {
          const { status: newStatus, location: newLocation } = resolveEventOutcome(actionKey, associatedLocation);
          const finalStatus = status || newStatus;
          const finalLocation = associatedLocation || newLocation;

          await Device.updateMany(
            { owner, serialNumber: { $in: affectedDevices }, deletedAt: null },
            {
              $push: { lifecycleEvents: { ...baseEvent, associatedLocation: finalLocation } },
              $set: {
                status: finalStatus,
                currentLocation: finalLocation,
                updatedBy: createdBy,
                updatedAt: new Date(),
                ...((actionKey === "deployment" || actionKey === "swapdeployment") && clientIdObj
                  ? { client: clientIdObj }
                  : { client: null }),
                linkedContractIds,
              },
            },
          ).session(session);

          if (contractIdObj && (actionKey === "deployment" || actionKey === "swapdeployment")) {
            await Contract.updateOne(
              { owner, _id: contractIdObj },
              { $addToSet: { deviceSerials: { $each: affectedDevices } } },
            ).session(session);
          }
        }

        return Device.find({ owner, serialNumber: { $in: affectedDevices }, deletedAt: null })
          .populate("client linkedContractIds")
          .session(session);
      });

      try {
        await BulkOperation.create({
          owner,
          bulkOpId,
          action: actionKey,
          affectedDevices,
          createdBy,
          timestamp: new Date(timestamp),
          description,
          associatedLocation,
          relatedReference,
        });
      } catch (bulkOpErr) {
        console.error("Failed to save BulkOperation record:", bulkOpErr.message);
      }

      res.json({
        message: `Bulk lifecycle event logged for ${updatedDevices.length} devices`,
        bulkOpId,
        updatedDevices: updatedDevices.map((d) => d.toObject()),
      });
    } catch (err) {
      next(err);
    }
  },
];

const bulkDeleteDevice = async (req, res, next) => {
  try {
    const { serialNumbers } = req.body;
    if (!Array.isArray(serialNumbers) || !serialNumbers.length) {
      return next(createError(400, "serialNumbers must be a non-empty array"));
    }

    const owner = req.user.id;

    const deletedDevices = await withTransaction(async (session) => {
      const devices = await Device.find({
        owner,
        serialNumber: { $in: serialNumbers },
        deletedAt: null,
      }).session(session);
      const missing = serialNumbers.filter((sn) => !devices.some((d) => d.serialNumber === sn));
      if (missing.length) throw createError(404, `Devices not found: ${missing.join(", ")}`);

      await Device.updateMany(
        { owner, serialNumber: { $in: serialNumbers }, deletedAt: null },
        { $set: { deletedAt: new Date() } },
      ).session(session);

      return devices.map((d) => d.serialNumber);
    });

    res.json({ message: `${deletedDevices.length} device(s) soft-deleted`, deletedSerialNumbers: deletedDevices });
  } catch (err) {
    next(err);
  }
};

const getBulkOperations = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      action,
      createdBy,
      startDate,
      endDate,
      serialNumber,
      clientName,
    } = req.query;
 
    const owner = req.user.id;
    const query = { owner };
 
    if (action)    query.action    = action;
    if (createdBy) query.createdBy = { $regex: createdBy, $options: 'i' };
    if (startDate && endDate) {
      query.timestamp = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
 
    if (serialNumber) {
      query.affectedDevices = {
        $elemMatch: { $regex: escapeRegex(serialNumber), $options: 'i' },
      };
    }
 
    if (clientName) {
      const client = await Client.findOne({
        owner,
        name: { $regex: escapeRegex(clientName), $options: 'i' },
      });
      if (client) {
        const clientDevices = await Device.find(
          { owner, client: client._id, deletedAt: null },
          'serialNumber',
        );
        const serials = clientDevices.map((d) => d.serialNumber);
        if (query.affectedDevices) {
          query.$and = [
            { affectedDevices: query.affectedDevices },
            { affectedDevices: { $in: serials } },
          ];
          delete query.affectedDevices;
        } else {
          query.affectedDevices = { $in: serials };
        }
      } else {
        return res.json({
          bulkOperations: [],
          total: 0,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: 0,
        });
      }
    }
 
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [ops, total] = await Promise.all([
      BulkOperation.find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
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

const getAllBulkOperations = async (req, res, next) => {
  try {
    const ops = await BulkOperation.find({ owner: req.user.id }).sort({ timestamp: -1 }).lean();
    res.json({ bulkOperations: ops, total: ops.length });
  } catch (err) {
    next(err);
  }
};

export {
  addDevice,
  getDevices,
  getDeviceBySerialNumber,
  updateDevice,
  updateDeviceBySerialNumber,
  bulkLogLifecycleEvent,
  bulkDeleteDevice,
  getBulkOperations,
  getAllBulkOperations,
  deleteDevice,
};