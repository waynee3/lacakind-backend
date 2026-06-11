const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
import axios from 'axios';
import Client from '../models/Client.js';
import Device from '../models/Device.js';
import { createError } from '../middleware/errorHandler.js';

const getClients = async (req, res, next) => {
  try {
    const {
      clientName,
      email,
      phone,
      location,
      contactPerson,
      search, 
      page = 1,
      limit,
    } = req.query;

    const query = { owner: req.user.id };

    const nameTerm = clientName || search;
    if (nameTerm)       query.name          = { $regex: escapeRegex(nameTerm), $options: 'i' };
    if (email)          query.email         = { $regex: escapeRegex(email), $options: 'i' };
    if (phone)          query.phone         = { $regex: escapeRegex(phone), $options: 'i' };
    if (contactPerson)  query.contactPerson = { $regex: escapeRegex(contactPerson), $options: 'i' };
    if (location && location !== 'All') query.location = location;

    let q = Client.find(query).select('-__v').sort({ createdAt: -1 });

    const limitNum = parseInt(limit);
    if (limit && !isNaN(limitNum) && limitNum > 0) {
      q = q.skip((parseInt(page) - 1) * limitNum).limit(limitNum);
    }

    const clients = await q;
    res.json(clients.map(c => c.toJSON()));
  } catch (err) {
    next(err);
  }
};

// POST /clients
const addClient = async (req, res, next) => {
  try {
    const { name, contactPerson, email, phone, address, location, notes } = req.body;
    if (!name || !location) return next(createError(400, 'name and location are required'));

    const client = await Client.create({
      owner: req.user.id,
      name,
      location,
      contactPerson: contactPerson || '',
      email:         email || '',
      phone:         phone || '',
      address:       address || '',
      notes,
    });
    res.status(201).json(client);
  } catch (err) {
    if (err.code === 11000) return next(createError(409, 'A client with this name already exists'));
    next(err);
  }
};

// PUT /clients/:id
const updateClient = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    delete updates.owner;
    const client = await Client.findOneAndUpdate(
      { owner: req.user.id, _id: req.params.id },
      updates,
      { new: true, runValidators: true },
    );
    if (!client) return next(createError(404, 'Client not found'));
    res.json(client);
  } catch (err) {
    if (err.code === 11000) return next(createError(409, 'A client with this name already exists'));
    next(err);
  }
};

// DELETE /clients/:id
const deleteClient = async (req, res, next) => {
  try {
    const owner = req.user.id;
    const client = await Client.findOne({ owner, _id: req.params.id });
    if (!client) return next(createError(404, 'Client not found'));

    const inUse = await Device.findOne({ owner, client: client._id, deletedAt: null });
    if (inUse) return next(createError(409, 'Client is referenced by one or more devices'));

    await client.deleteOne();
    res.json({ message: 'Client deleted' });
  } catch (err) {
    next(err);
  }
};

// GET /clients/client-names
const getClientNames = async (req, res, next) => {
  try {
    const clients = await Client.find({ owner: req.user.id }, 'name');
    res.json(clients.map(c => ({ value: c.name, name: c.name })));
  } catch (err) {
    next(err);
  }
};

// GET /clients/unique-locations
const getUniqueLocations = async (req, res, next) => {
  try {
    const locations = await Client.distinct('location', { owner: req.user.id });
    res.json(['All', ...locations]);
  } catch (err) {
    next(err);
  }
};

// GET /clients/:id
const getClientById = async (req, res, next) => {
  try {
    const client = await Client.findOne({ owner: req.user.id, _id: req.params.id });
    if (!client) return next(createError(404, 'Client not found'));
    res.json(client);
  } catch (err) {
    next(err);
  }
};

// GET /clients/geocode?address=...   (optional, only called explicitly)
const getGeocodedAddress = async (req, res, next) => {
  try {
    const { address } = req.query;
    if (!address) return next(createError(400, 'Address is required'));

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const { data } = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
    );

    if (data.status !== 'OK') {
      return next(createError(400, `Geocoding failed: ${data.status}`));
    }
    res.json(data.results[0].geometry.location);
  } catch (err) {
    next(err);
  }
};

export {
  getClients,
  addClient,
  updateClient,
  deleteClient,
  getClientNames,
  getUniqueLocations,
  getClientById,
  getGeocodedAddress,
};