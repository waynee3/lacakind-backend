const Choice   = require('../models/Choice');
const Client   = require('../models/Client');
const Contract = require('../models/Contract');
const Device   = require('../models/Kiosk');
const { createError } = require('../middleware/errorHandler');

// GET /choices?type=...
const getChoices = async (req, res, next) => {
  try {
    const { type } = req.query;
    if (!type) return next(createError(400, 'type query parameter is required'));

    if (type === 'client') {
      const clients = await Client.find().lean();
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
      const contracts = await Contract.find().lean();
      return res.json(contracts.map(c => ({
        _id:       c._id,
        type:      'contract',
        value:     c._id.toString(),
        name:      c.contractRef,
        createdAt: c.createdAt,
        updatedAt: c.createdAt,
      })));
    }

    const choices = await Choice.find({ type }).lean();
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
      // Creating a client via the choice API is no longer supported to keep
      // Client creation consistent (requires contactPerson, email, etc.)
      return next(createError(400, 'Clients must be added via the /clients endpoint'));
    }

    const choice = await Choice.create({ type, value: value || name, name });
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

    if (type === 'client') {
      const client = await Client.findById(req.params.id);
      if (!client) return next(createError(404, 'Client not found'));
      const inUse = await Device.findOne({ client: client._id });
      if (inUse) return next(createError(409, 'Client is referenced by one or more devices'));
      await client.deleteOne();
      return res.json({ message: 'Client deleted' });
    }

    if (type === 'contract') {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return next(createError(404, 'Contract not found'));
      const inUse = await Device.findOne({ linkedContractIds: contract._id });
      if (inUse) return next(createError(409, 'Contract is referenced by one or more devices'));
      await contract.deleteOne();
      return res.json({ message: 'Contract deleted' });
    }

    const choice = await Choice.findById(req.params.id);
    if (!choice) return next(createError(404, 'Choice not found'));
    const inUse = await Device.findOne(
      choice.type === 'status' ? { status: choice.value } : { modelType: choice.value }
    );
    if (inUse) return next(createError(409, 'Choice is in use by one or more devices'));
    await choice.deleteOne();
    res.json({ message: 'Choice deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { getChoices, addChoice, deleteChoice };
