import Choice from '../models/Choice.js';
import Client from '../models/Client.js';
import Contract from '../models/Contract.js';
import Device from '../models/Device.js';
import { createError } from '../middleware/errorHandler.js';

// GET /choices?type=...
const getChoices = async (req, res, next) => {
  try {
    const { type } = req.query;
    if (!type) return next(createError(400, 'type query parameter is required'));
    const owner = req.user.id;

    if (type === 'client') {
      const clients = await Client.find({ owner }).lean();
      return res.json(clients.map(c => ({
        _id:       c._id,
        type:      'client',
        value:     c._id.toString(),
        name:      c.name,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt || c.createdAt,
      })));
    }

    if (type === 'contract') {
      const contracts = await Contract.find({ owner }).lean();
      return res.json(contracts.map(c => ({
        _id:       c._id,
        type:      'contract',
        value:     c._id.toString(),
        name:      c.contractRef,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      })));
    }

    const choices = await Choice.find({ owner, type }).lean();
    res.json(choices.map(ch => ({
      _id:       ch._id,
      type:      ch.type,
      value:     ch.value,
      name:      ch.name || ch.value,
      createdAt: ch.createdAt,
      updatedAt: ch.updatedAt,
    })));
  } catch (err) {
    next(err);
  }
};

// POST /choices
const addChoice = async (req, res, next) => {
  try {
    const { type, value, name } = req.body;
    if (!type || !name) return next(createError(400, 'type and name are required'));

    if (type === 'contract') {
      return next(createError(400, 'Contracts must be added via the /contracts endpoint'));
    }
    if (type === 'client') {
      return next(createError(400, 'Clients must be added via the /clients endpoint'));
    }

    const choice = await Choice.create({ owner: req.user.id, type, value: value || name, name });
    res.status(201).json(choice);
  } catch (err) {
    next(err);
  }
};

// DELETE /choices/:id?type=...
const deleteChoice = async (req, res, next) => {
  try {
    const { type } = req.query;
    if (!type) return next(createError(400, 'type query parameter is required'));
    const owner = req.user.id;

    if (type === 'client') {
      const client = await Client.findOne({ owner, _id: req.params.id });
      if (!client) return next(createError(404, 'Client not found'));
      const inUse = await Device.findOne({ owner, client: client._id, deletedAt: null });
      if (inUse) return next(createError(409, 'Client is referenced by one or more devices'));
      await client.deleteOne();
      return res.json({ message: 'Client deleted' });
    }

    if (type === 'contract') {
      const contract = await Contract.findOne({ owner, _id: req.params.id });
      if (!contract) return next(createError(404, 'Contract not found'));
      const inUse = await Device.findOne({ owner, linkedContractIds: contract._id, deletedAt: null });
      if (inUse) return next(createError(409, 'Contract is referenced by one or more devices'));
      await contract.deleteOne();
      return res.json({ message: 'Contract deleted' });
    }

    const choice = await Choice.findOne({ owner, _id: req.params.id });
    if (!choice) return next(createError(404, 'Choice not found'));
    const inUse = await Device.findOne({
      owner,
      deletedAt: null,
      ...(choice.type === 'status' ? { status: choice.value } : { modelType: choice.value }),
    });
    if (inUse) return next(createError(409, 'Choice is in use by one or more devices'));
    await choice.deleteOne();
    res.json({ message: 'Choice deleted' });
  } catch (err) {
    next(err);
  }
};

export { getChoices, addChoice, deleteChoice };