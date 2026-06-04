import { create, find, findOneAndUpdate } from '../models/RepairIncident';
import { findOne } from '../models/Device';
import { createError } from '../middleware/errorHandler.js';

// POST /repairs
const createRepairIncident = async (req, res, next) => {
  try {
    const incident = await create(req.body);

    const device = await findOne({ serialNumber: incident.deviceSerial });
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
    const incidents = await find();
    res.json(incidents);
  } catch (err) {
    next(err);
  }
};

// PUT /repairs/:id
const updateRepairIncident = async (req, res, next) => {
  try {
    const incident = await findOneAndUpdate(
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
    const incident = await findOneAndUpdate(
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

export default { createRepairIncident, getRepairIncidents, updateRepairIncident, deploySpareUnit };
