import { Types } from 'mongoose';
import { find, findById, create, findByIdAndUpdate, updateOne } from '../models/Contract';
import { find as _find, updateMany } from '../models/Device';
import { findById as _findById } from '../models/Client';
import { withTransaction } from '../utils/withTransaction';
const { createError }     = require('../middleware/errorHandler').default;


// GET /contracts
const getContracts = async (req, res, next) => {
  try {
    const contracts = await find().populate('clientId');
    res.json(contracts.map(formatContract));
  } catch (err) {
    next(err);
  }
};

// GET /contracts/:id
const getContractById = async (req, res, next) => {
  try {
    const contract = await findById(req.params.id).populate('clientId');
    if (!contract) return next(createError(404, 'Contract not found'));
    res.json(formatContract(contract));
  } catch (err) {
    next(err);
  }
};

// POST /contracts
const addContract = async (req, res, next) => {
  try {
    const contract = await create({
      ...req.body,
      createdBy:     req.user.email,
      paymentStatus: req.body.paymentStatus || 'Not Paid',
    });

    // Auto-link devices belonging to this client
    if (contract.clientId) {
      const devices  = await _find({ client: contract.clientId, deletedAt: null });
      const serials = devices.map(k => k.serialNumber);
      contract.deviceSerials = serials;
      await contract.save();
      await updateMany(
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
    const existing = await findById(req.params.id);
    if (!existing) return next(createError(404, 'Contract not found'));

    const prevSerials = existing.deviceSerials || [];
    const updated     = await findByIdAndUpdate(
      req.params.id,
      { $set: { ...req.body, paymentStatus: req.body.paymentStatus || existing.paymentStatus } },
      { new: true, runValidators: true }
    );

    const newSerials     = updated.deviceSerials || [];
    const removedSerials = prevSerials.filter(s => !newSerials.includes(s));
    const addedSerials   = newSerials.filter(s => !prevSerials.includes(s));

    if (removedSerials.length) {
      await updateMany({ serialNumber: { $in: removedSerials } }, { $pull: { linkedContractIds: existing._id } });
    }
    if (addedSerials.length) {
      await updateMany({ serialNumber: { $in: addedSerials } }, { $addToSet: { linkedContractIds: existing._id } });
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// PUT /contracts/:id/terminate
const terminateContract = async (req, res, next) => {
  try {
    const contract = await findById(req.params.id);
    if (!contract) return next(createError(404, 'Contract not found'));

    contract.status = 'Terminated';
    await contract.save();

    if (contract.deviceSerials.length) {
      await updateMany(
        { serialNumber: { $in: contract.deviceSerials } },
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
    const contract = await findById(req.params.id);
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

// POST /contracts/update-devices
const updateDevicesForContract = async (req, res, next) => {
  try {
    const { contractId, clientId, deviceSerials } = req.body;

    if (!Types.ObjectId.isValid(contractId)) return next(createError(400, `Invalid contractId: ${contractId}`));
    if (!Types.ObjectId.isValid(clientId))   return next(createError(400, `Invalid clientId: ${clientId}`));
    if (!Array.isArray(deviceSerials))                  return next(createError(400, 'deviceSerials must be an array'));

    await withTransaction(async (session) => {
      const [contract, client] = await Promise.all([
        findById(contractId).session(session),
        _findById(clientId).session(session),
      ]);
      if (!contract) throw createError(404, 'Contract not found');
      if (!client)   throw createError(404, 'Client not found');

      if (deviceSerials.length) {
        const devices = await _find({ serialNumber: { $in: deviceSerials }, deletedAt: null }).session(session);
        const missing = deviceSerials.filter(sn => !devices.some(d => d.serialNumber === sn));
        if (missing.length) throw createError(400, `Devices not found: ${missing.join(', ')}`);

        const wrongClient = devices.filter(d => d.client && d.client.toString() !== clientId);
        if (wrongClient.length) {
          throw createError(400, `Devices belong to a different client: ${wrongClient.map(d => d.serialNumber).join(', ')}`);
        }

        await updateMany(
          { serialNumber: { $in: deviceSerials }, deletedAt: null },
          {
            $set: { client: new Types.ObjectId(clientId), status: 'Deployed', updatedBy: 'system', updatedAt: new Date() },
            $addToSet: { linkedContractIds: new Types.ObjectId(contractId) },
          },
          { session }
        );
      }

      await updateOne({ _id: contractId }, { $set: { deviceSerials } }, { session });
    });

    res.json({ message: `Updated ${deviceSerials.length} devices for contract ${contractId}` });
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

export default { getContracts, getContractById, addContract, updateContract, terminateContract, bulkUploadDocuments, updateDevicesForContract };
