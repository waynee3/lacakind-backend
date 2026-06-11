import RepairIncident from '../models/RepairIncident.js';
import Device from '../models/Device.js';
import { createError } from '../middleware/errorHandler.js';

// POST /repairs
const createRepairIncident = async (req, res, next) => {
  try {
    const owner = req.user.id;
    const incident = await RepairIncident.create({ ...req.body, owner });

    // Link incident to its device (scoped to owner)
    const device = await Device.findOne({ owner, serialNumber: incident.deviceSerial, deletedAt: null });
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
    const incidents = await RepairIncident.find({ owner: req.user.id });
    res.json(incidents);
  } catch (err) {
    next(err);
  }
};

// PUT /repairs/:id
const updateRepairIncident = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    delete updates.owner;
    const incident = await RepairIncident.findOneAndUpdate(
      { owner: req.user.id, id: req.params.id },
      updates,
      { new: true, runValidators: true },
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
    const updates = { ...req.body };
    delete updates.owner;
    const incident = await RepairIncident.findOneAndUpdate(
      { owner: req.user.id, id: req.params.id },
      updates,
      { new: true, runValidators: true },
    );
    if (!incident) return next(createError(404, 'Repair incident not found'));
    res.json(incident);
  } catch (err) {
    next(err);
  }
};

export { createRepairIncident, getRepairIncidents, updateRepairIncident, deploySpareUnit };