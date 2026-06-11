import Device from '../models/Device.js';
import { createError } from '../middleware/errorHandler.js';

// POST /logs/:serialNumber
const addLog = async (req, res, next) => {
  try {
    const device = await Device.findOne({
      owner: req.user.id,
      serialNumber: req.params.serialNumber,
      deletedAt: null,
    });
    if (!device) return next(createError(404, 'Device not found'));

    device.lifecycleEvents.push(req.body);
    device.updatedAt = new Date();
    device.updatedBy = req.user.email;
    await device.save();

    res.status(201).json(device.lifecycleEvents.at(-1));
  } catch (err) {
    next(err);
  }
};

// GET /logs?deviceSerial=...
const getLogs = async (req, res, next) => {
  try {
    const { deviceSerial } = req.query;
    if (!deviceSerial) return next(createError(400, 'deviceSerial query parameter is required'));

    const device = await Device.findOne({
      owner: req.user.id,
      serialNumber: deviceSerial,
      deletedAt: null,
    });
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

    const device = await Device.findOne({ owner: req.user.id, _id: deviceId });
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

    const device = await Device.findOne({ owner: req.user.id, _id: deviceId });
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

export { addLog, getLogs, updateLog, deleteLog };