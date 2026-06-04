import { body, validationResult } from 'express-validator';
import { findOne, findById } from '../models/Device';
import { normaliseEventType, resolveEventOutcome } from '../config/eventRules';
import { createError } from '../middleware/errorHandler.js';

// POST /logs/:serialNumber
const addLog = [
  body('eventType').notEmpty().withMessage('Event type is required'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { eventType: rawEventType, description, associatedLocation, responsibleParty, relatedReference } = req.body;
      const serialNumber = req.params.serialNumber;

      const device = await findOne({ serialNumber, deletedAt: null });
      if (!device) return next(createError(404, `Device not found: ${serialNumber}`));

      const lastEvent = device.lifecycleEvents.at(-1);
      const durationSinceLastEvent = lastEvent
        ? Math.floor((Date.now() - new Date(lastEvent.timestamp)) / 3_600_000)
        : null;

      const actionKey = normaliseEventType(rawEventType);
      if (!actionKey) return next(createError(400, `Unknown event type: ${rawEventType}`));

      const { status: newStatus, location: newLocation } = resolveEventOutcome(actionKey, associatedLocation?.trim());

      const newLog = {
        timestamp:            new Date(),
        eventType:            actionKey,
        description,
        associatedLocation:   associatedLocation?.trim() || newLocation,
        responsibleParty,
        relatedReference,
        durationSinceLastEvent,
      };

      device.lifecycleEvents.push(newLog);
      device.status          = newStatus;
      device.currentLocation = newLocation;
      device.updatedAt       = new Date();
      device.updatedBy       = req.user.email;

      await device.save();
      res.status(201).json(newLog);
    } catch (err) {
      next(err);
    }
  },
];

// GET /logs?deviceSerial=...
const getLogs = async (req, res, next) => {
  try {
    const { deviceSerial } = req.query;
    if (!deviceSerial) return next(createError(400, 'deviceSerial query parameter is required'));

    const device = await findOne({ serialNumber: deviceSerial, deletedAt: null });
    if (!device) return next(createError(404, 'Device not found'));

    res.json(device.lifecycleEvents);
  } catch (err) {
    next(err);
  }
};

// PUT /logs?deviceId=...&logIndex=...
const updateLog = async (req, res, next) => {
  try {
    const { deviceId, logIndex } = req.query;
    if (!deviceId || logIndex === undefined) {
      return next(createError(400, 'deviceId and logIndex query parameters are required'));
    }

    const device = await findById(deviceId);
    if (!device) return next(createError(404, 'Device not found'));

    const index = parseInt(logIndex, 10);
    if (index >= device.lifecycleEvents.length) return next(createError(404, 'Log entry not found'));

    Object.assign(device.lifecycleEvents[index], req.body);
    device.updatedAt = new Date();
    device.updatedBy = req.user.email;
    await device.save();

    res.json(device.lifecycleEvents[index]);
  } catch (err) {
    next(err);
  }
};

// DELETE /logs?deviceId=...&logIndex=...
const deleteLog = async (req, res, next) => {
  try {
    const { deviceId, logIndex } = req.query;
    if (!deviceId || logIndex === undefined) {
      return next(createError(400, 'deviceId and logIndex query parameters are required'));
    }

    const device = await findById(deviceId);
    if (!device) return next(createError(404, 'Device not found'));

    const index = parseInt(logIndex, 10);
    if (index >= device.lifecycleEvents.length) return next(createError(404, 'Log entry not found'));

    device.lifecycleEvents.splice(index, 1);
    device.updatedAt = new Date();
    device.updatedBy = req.user.email;
    await device.save();

    res.json({ message: 'Log entry deleted' });
  } catch (err) {
    next(err);
  }
};

export default { addLog, getLogs, updateLog, deleteLog };
