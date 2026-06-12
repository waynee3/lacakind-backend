import { Types } from 'mongoose';
import Contract from '../models/Contract.js';
import Device from '../models/Device.js';
import Client from '../models/Client.js';
import { withTransaction } from '../utils/withTransaction.js';
import { createError } from '../middleware/errorHandler.js';

async function generateContractRef(owner, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const digits = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
    const ref    = `LCKID-${digits}`;
    const exists = await Contract.exists({ owner, contractRef: ref });
    if (!exists) return ref;
  }
  return `LCKID-${Date.now().toString().slice(-5)}`;
}

const getContracts = async (req, res, next) => {
  try {
    const {
      contractId,
      clientName,
      contractType,
      startDate,
      endDate,
      status,
      paymentStatus,
      page  = 1,
      limit = 20,
    } = req.query;

    const query = { owner: req.user.id };
    if (contractId)   query.contractId   = { $regex: contractId,   $options: 'i' };
    if (contractType) query.contractType = contractType;
    if (status)       query.status       = status;
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (startDate && endDate) {
      query.startDate = { $gte: new Date(startDate) };
      query.endDate   = { $lte: new Date(endDate) };
    }
    if (clientName) {
      const client = await Client.findOne({
        owner: req.user.id,
        name: { $regex: clientName, $options: 'i' },
      });
      if (client) query.clientId = client._id;
      else return res.json([]);
    }

    const skip      = (parseInt(page) - 1) * parseInt(limit);
    const contracts = await Contract.find(query)
      .populate('clientId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json(contracts.map(formatContract));
  } catch (err) {
    next(err);
  }
};

const getContractById = async (req, res, next) => {
  try {
    const contract = await Contract.findOne({
      owner: req.user.id,
      _id: req.params.id,
    }).populate('clientId');
    if (!contract) return next(createError(404, 'Contract not found'));
    res.json(formatContract(contract));
  } catch (err) {
    next(err);
  }
};

const addContract = async (req, res, next) => {
  try {
    const owner = req.user.id;

    const contractRef = await generateContractRef(owner);

    const { contractRef: _ignored, ...rest } = req.body;

    const contract = await Contract.create({
      ...rest,
      owner,
      contractRef,
      createdBy:     req.user.email,
      paymentStatus: req.body.paymentStatus || 'Not Paid',
    });

    if (contract.clientId) {
      const devices = await Device.find({
        owner,
        client: contract.clientId,
        deletedAt: null,
      });
      const serials = devices.map(d => d.serialNumber);
      if (serials.length) {
        contract.deviceSerials = serials;
        await contract.save();
        await Device.updateMany(
          { owner, serialNumber: { $in: serials } },
          { $addToSet: { linkedContractIds: contract._id } },
        );
      }
    }

    res.status(201).json(contract);
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue || {})[0] || 'field';
      return next(createError(409, `Duplicate value for ${field}`));
    }
    next(err);
  }
};

const updateContract = async (req, res, next) => {
  try {
    const owner    = req.user.id;
    const existing = await Contract.findOne({ owner, _id: req.params.id });
    if (!existing) return next(createError(404, 'Contract not found'));

    const prevSerials = existing.deviceSerials || [];
    const updates     = { ...req.body };
    delete updates.owner;
    delete updates.contractRef;

    const updated = await Contract.findOneAndUpdate(
      { owner, _id: req.params.id },
      {
        $set: {
          ...updates,
          paymentStatus: updates.paymentStatus || existing.paymentStatus,
        },
      },
      { new: true, runValidators: true },
    );

    const newSerials     = updated.deviceSerials || [];
    const removedSerials = prevSerials.filter(s => !newSerials.includes(s));
    const addedSerials   = newSerials.filter(s => !prevSerials.includes(s));

    if (removedSerials.length) {
      await Device.updateMany(
        { owner, serialNumber: { $in: removedSerials } },
        { $pull: { linkedContractIds: existing._id } },
      );
    }
    if (addedSerials.length) {
      await Device.updateMany(
        { owner, serialNumber: { $in: addedSerials } },
        { $addToSet: { linkedContractIds: existing._id } },
      );
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

const terminateContract = async (req, res, next) => {
  try {
    const owner    = req.user.id;
    const contract = await Contract.findOne({ owner, _id: req.params.id });
    if (!contract) return next(createError(404, 'Contract not found'));

    contract.status = 'Terminated';
    await contract.save();

    if (contract.deviceSerials.length) {
      await Device.updateMany(
        { owner, serialNumber: { $in: contract.deviceSerials } },
        { $pull: { linkedContractIds: contract._id } },
      );
    }

    res.json({ message: 'Contract terminated', contract });
  } catch (err) {
    next(err);
  }
};

const bulkUploadDocuments = async (req, res, next) => {
  try {
    const contract = await Contract.findOne({
      owner: req.user.id,
      _id: req.params.id,
    });
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
    const owner = req.user.id;
    const { contractId, clientId, deviceSerials } = req.body;

    if (!Types.ObjectId.isValid(contractId))
      return next(createError(400, `Invalid contractId: ${contractId}`));
    if (!Types.ObjectId.isValid(clientId))
      return next(createError(400, `Invalid clientId: ${clientId}`));
    if (!Array.isArray(deviceSerials))
      return next(createError(400, 'deviceSerials must be an array'));

    await withTransaction(async (session) => {
      const [contract, client] = await Promise.all([
        Contract.findOne({ owner, _id: contractId }).session(session),
        Client.findOne({ owner, _id: clientId }).session(session),
      ]);
      if (!contract) throw createError(404, 'Contract not found');
      if (!client)   throw createError(404, 'Client not found');

      if (deviceSerials.length) {
        const devices = await Device.find({
          owner,
          serialNumber: { $in: deviceSerials },
          deletedAt: null,
        }).session(session);

        const missing = deviceSerials.filter(
          sn => !devices.some(d => d.serialNumber === sn),
        );
        if (missing.length)
          throw createError(400, `Devices not found: ${missing.join(', ')}`);

        const wrongClient = devices.filter(
          d => d.client && d.client.toString() !== clientId,
        );
        if (wrongClient.length) {
          throw createError(
            400,
            `Devices belong to a different client: ${wrongClient.map(d => d.serialNumber).join(', ')}`,
          );
        }

        await Device.updateMany(
          { owner, serialNumber: { $in: deviceSerials }, deletedAt: null },
          {
            $set: {
              client:    new Types.ObjectId(clientId),
              status:    'Deployed',
              updatedBy: 'system',
              updatedAt: new Date(),
            },
            $addToSet: { linkedContractIds: new Types.ObjectId(contractId) },
          },
          { session },
        );
      }

      await Contract.updateOne(
        { owner, _id: contractId },
        { $set: { deviceSerials } },
        { session },
      );
    });

    res.json({
      message: `Updated ${deviceSerials.length} devices for contract ${contractId}`,
    });
  } catch (err) {
    next(err);
  }
};

function formatContract(contract) {
  const obj = contract.toObject ? contract.toObject() : contract;
  return {
    ...obj,
    id:           obj._id?.toString() ?? obj.id,
    clientId:     obj.clientId
      ? (obj.clientId.toObject ? obj.clientId.toObject() : obj.clientId)
      : null,
    clientName:   obj.clientId?.name ?? obj.clientName,
    paymentStatus: obj.paymentStatus,
  };
}

export {
  getContracts,
  getContractById,
  addContract,
  updateContract,
  terminateContract,
  bulkUploadDocuments,
  updateDevicesForContract,
};