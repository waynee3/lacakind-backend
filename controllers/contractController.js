const mongoose      = require('mongoose');
const Contract      = require('../models/Contract');
const Device        = require('../models/Kiosk');
const Client        = require('../models/Client');
const { withTransaction } = require('../utils/withTransaction');
const { createError }     = require('../middleware/errorHandler');

// GET /contracts
const getContracts = async (req, res, next) => {
  try {
    const contracts = await Contract.find().populate('clientId');
    res.json(contracts.map(formatContract));
  } catch (err) {
    next(err);
  }
};

// GET /contracts/:id
const getContractById = async (req, res, next) => {
  try {
    const contract = await Contract.findById(req.params.id).populate('clientId');
    if (!contract) return next(createError(404, 'Contract not found'));
    res.json(formatContract(contract));
  } catch (err) {
    next(err);
  }
};

// POST /contracts
const addContract = async (req, res, next) => {
  try {
    const contract = await Contract.create({
      ...req.body,
      createdBy:     req.user.email,
      paymentStatus: req.body.paymentStatus || 'Not Paid',
    });

    // Auto-link kiosks belonging to this client
    if (contract.clientId) {
      const kiosks  = await Device.find({ client: contract.clientId, deletedAt: null });
      const serials = kiosks.map(k => k.serialNumber);
      contract.kioskSerials = serials;
      await contract.save();
      await Device.updateMany(
        { serialNumber: { $in: serials } },
        { $addToSet: { linkedContractIds: contract._id } }
      );
    }

    res.status(201).json(contract);
  } catch (err) {
    next(err);
  }
};

// PUT /contracts/:id
const updateContract = async (req, res, next) => {
  try {
    const existing = await Contract.findById(req.params.id);
    if (!existing) return next(createError(404, 'Contract not found'));

    const prevSerials = existing.kioskSerials || [];
    const updated     = await Contract.findByIdAndUpdate(
      req.params.id,
      { $set: { ...req.body, paymentStatus: req.body.paymentStatus || existing.paymentStatus } },
      { new: true, runValidators: true }
    );

    const newSerials     = updated.kioskSerials || [];
    const removedSerials = prevSerials.filter(s => !newSerials.includes(s));
    const addedSerials   = newSerials.filter(s => !prevSerials.includes(s));

    if (removedSerials.length) {
      await Device.updateMany({ serialNumber: { $in: removedSerials } }, { $pull: { linkedContractIds: existing._id } });
    }
    if (addedSerials.length) {
      await Device.updateMany({ serialNumber: { $in: addedSerials } }, { $addToSet: { linkedContractIds: existing._id } });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// PUT /contracts/:id/terminate
const terminateContract = async (req, res, next) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return next(createError(404, 'Contract not found'));

    contract.status = 'Terminated';
    await contract.save();

    if (contract.kioskSerials.length) {
      await Device.updateMany(
        { serialNumber: { $in: contract.kioskSerials } },
        { $pull: { linkedContractIds: contract._id } }
      );
    }

    res.json({ message: 'Contract terminated', contract });
  } catch (err) {
    next(err);
  }
};

// POST /contracts/:id/documents
const bulkUploadDocuments = async (req, res, next) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return next(createError(404, 'Contract not found'));

    const { documentUrls } = req.body;
    if (!Array.isArray(documentUrls) || !documentUrls.length) {
      return next(createError(400, 'documentUrls must be a non-empty array'));
    }

    contract.documents.push(...documentUrls);
    await contract.save();
    res.json({ message: 'Documents uploaded', contract });
  } catch (err) {
    next(err);
  }
};

// POST /contracts/update-kiosks
const updateKiosksForContract = async (req, res, next) => {
  try {
    const { contractId, clientId, kioskSerials } = req.body;

    if (!mongoose.Types.ObjectId.isValid(contractId)) return next(createError(400, `Invalid contractId: ${contractId}`));
    if (!mongoose.Types.ObjectId.isValid(clientId))   return next(createError(400, `Invalid clientId: ${clientId}`));
    if (!Array.isArray(kioskSerials))                  return next(createError(400, 'kioskSerials must be an array'));

    await withTransaction(async (session) => {
      const [contract, client] = await Promise.all([
        Contract.findById(contractId).session(session),
        Client.findById(clientId).session(session),
      ]);
      if (!contract) throw createError(404, 'Contract not found');
      if (!client)   throw createError(404, 'Client not found');

      if (kioskSerials.length) {
        const kiosks = await Device.find({ serialNumber: { $in: kioskSerials }, deletedAt: null }).session(session);
        const missing = kioskSerials.filter(sn => !kiosks.some(k => k.serialNumber === sn));
        if (missing.length) throw createError(400, `Kiosks not found: ${missing.join(', ')}`);

        const wrongClient = kiosks.filter(k => k.client && k.client.toString() !== clientId);
        if (wrongClient.length) {
          throw createError(400, `Kiosks belong to a different client: ${wrongClient.map(k => k.serialNumber).join(', ')}`);
        }

        await Device.updateMany(
          { serialNumber: { $in: kioskSerials }, deletedAt: null },
          {
            $set: { client: new mongoose.Types.ObjectId(clientId), status: 'Deployed', updatedBy: 'system', updatedAt: new Date() },
            $addToSet: { linkedContractIds: new mongoose.Types.ObjectId(contractId) },
          },
          { session }
        );
      }

      await Contract.updateOne({ _id: contractId }, { $set: { kioskSerials } }, { session });
    });

    res.json({ message: `Updated ${kioskSerials.length} kiosks for contract ${contractId}` });
  } catch (err) {
    next(err);
  }
};

// ─── helpers ────────────────────────────────────────────────────────────────

function formatContract(contract) {
  const obj = contract.toObject ? contract.toObject() : contract;
  return {
    ...obj,
    clientId:      obj.clientId ? (obj.clientId.toObject ? obj.clientId.toObject() : obj.clientId) : null,
    clientName:    obj.clientId?.name ?? obj.clientName,
    paymentStatus: obj.paymentStatus,
  };
}

module.exports = { getContracts, getContractById, addContract, updateContract, terminateContract, bulkUploadDocuments, updateKiosksForContract };
