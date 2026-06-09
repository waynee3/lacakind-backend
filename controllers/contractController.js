import { Types } from 'mongoose';
import Contract from '../models/Contract.js';
import Device from '../models/Device.js';
import Client from '../models/Client.js';
import { withTransaction } from '../utils/withTransaction.js';
import { createError } from '../middleware/errorHandler.js';

const getContracts = async (req, res, next) => {
  try {
    const contracts = await Contract.find().populate('clientId');
    res.json(contracts.map(formatContract));
  } catch (err) {
    next(err);
  }
};

const getContractById = async (req, res, next) => {
  try {
    const contract = await Contract.findById(req.params.id).populate('clientId');
    if (!contract) return next(createError(404, 'Contract not found'));
    res.json(formatContract(contract));
  } catch (err) {
    next(err);
  }
};

const addContract = async (req, res, next) => {
  try {
    const contract = await Contract.create({
      ...req.body,
      createdBy:     req.user.email,
      paymentStatus: req.body.paymentStatus || 'Not Paid',
    });

    if (contract.clientId) {
      const devices = await Device.find({ client: contract.clientId, deletedAt: null });
      const serials = devices.map(k => k.serialNumber);
      contract.deviceSerials = serials;
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

const updateContract = async (req, res, next) => {
  try {
    const existing = await Contract.findById(req.params.id);
    if (!existing) return next(createError(404, 'Contract not found'));

    const prevSerials = existing.deviceSerials || [];
    const updated     = await Contract.findByIdAndUpdate(
      req.params.id,
      { $set: { ...req.body, paymentStatus: req.body.paymentStatus || existing.paymentStatus } },
      { new: true, runValidators: true }
    );

    const newSerials     = updated.deviceSerials || [];
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

const terminateContract = async (req, res, next) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return next(createError(404, 'Contract not found'));

    contract.status = 'Terminated';
    await contract.save();

    if (contract.deviceSerials.length) {
      await Device.updateMany(
        { serialNumber: { $in: contract.deviceSerials } },
        { $pull: { linkedContractIds: contract._id } }
      );
    }

    res.json({ message: 'Contract terminated', contract });
  } catch (err) {
    next(err);
  }
};

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

const updateDevicesForContract = async (req, res, next) => {
  try {
    const { contractId, clientId, deviceSerials } = req.body;

    if (!Types.ObjectId.isValid(contractId)) return next(createError(400, `Invalid contractId: ${contractId}`));
    if (!Types.ObjectId.isValid(clientId))   return next(createError(400, `Invalid clientId: ${clientId}`));
    if (!Array.isArray(deviceSerials))        return next(createError(400, 'deviceSerials must be an array'));

    await withTransaction(async (session) => {
      const [contract, client] = await Promise.all([
        Contract.findById(contractId).session(session),
        Client.findById(clientId).session(session),
      ]);
      if (!contract) throw createError(404, 'Contract not found');
      if (!client)   throw createError(404, 'Client not found');

      if (deviceSerials.length) {
        const devices = await Device.find({ serialNumber: { $in: deviceSerials }, deletedAt: null }).session(session);
        const missing = deviceSerials.filter(sn => !devices.some(d => d.serialNumber === sn));
        if (missing.length) throw createError(400, `Devices not found: ${missing.join(', ')}`);

        const wrongClient = devices.filter(d => d.client && d.client.toString() !== clientId);
        if (wrongClient.length) {
          throw createError(400, `Devices belong to a different client: ${wrongClient.map(d => d.serialNumber).join(', ')}`);
        }

        await Device.updateMany(
          { serialNumber: { $in: deviceSerials }, deletedAt: null },
          {
            $set: { client: new Types.ObjectId(clientId), status: 'Deployed', updatedBy: 'system', updatedAt: new Date() },
            $addToSet: { linkedContractIds: new Types.ObjectId(contractId) },
          },
          { session }
        );
      }

      await Contract.updateOne({ _id: contractId }, { $set: { deviceSerials } }, { session });
    });

    res.json({ message: `Updated ${deviceSerials.length} devices for contract ${contractId}` });
  } catch (err) {
    next(err);
  }
};

function formatContract(contract) {
  const obj = contract.toObject ? contract.toObject() : contract;
  return {
    ...obj,
    clientId:      obj.clientId ? (obj.clientId.toObject ? obj.clientId.toObject() : obj.clientId) : null,
    clientName:    obj.clientId?.name ?? obj.clientName,
    paymentStatus: obj.paymentStatus,
  };
}

export { getContracts, getContractById, addContract, updateContract, terminateContract, bulkUploadDocuments, updateDevicesForContract };