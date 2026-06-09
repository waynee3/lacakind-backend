import RepairIncident from '../models/RepairIncident.js';
import Device from '../models/Device.js';
import { createError } from '../middleware/errorHandler.js';

// POST /repairs
const createRepairIncident = async (req, res, next) => {
  try {
    const incident = await RepairIncident.create(req.body);

    const device = await Device.findOne({ serialNumber: incident.deviceSerial });
    if (device) {
      device.repairIncidents.push(incident._id);
      await device.save();
    }

    res.status(201).json(incident);
  } catch (err) {
    next(err);
  }
};

// GET /repairs
const getRepairIncidents = async (req, res, next) => {
  try {
    const incidents = await RepairIncident.find();
    res.json(incidents);
  } catch (err) {
    next(err);
  }
};

// PUT /repairs/:id
const updateRepairIncident = async (req, res, next) => {
  try {
    const incident = await RepairIncident.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!incident) return next(createError(404, 'Repair incident not found'));
    res.json(incident);
  } catch (err) {
    next(err);
  }
};

// POST /repairs/:id/spare
const deploySpareUnit = async (req, res, next) => {
  try {
    const incident = await RepairIncident.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!incident) return next(createError(404, 'Repair incident not found'));
    res.json(incident);
  } catch (err) {
    next(err);
  }
};

export { createRepairIncident, getRepairIncidents, updateRepairIncident, deploySpareUnit };
