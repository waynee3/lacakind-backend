const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
import { get } from 'axios';
import { find, create, distinct, findById } from '../models/Client';
import { createError } from '../middleware/errorHandler.js';

// GET /clients
const getClients = async (req, res, next) => {
  try {
    const { search, location, limit } = req.query;
    const query = {};

    if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };
    if (location && location !== 'All') query.location = location;

    const parsedLimit = parseInt(limit) || 0;
    const clients = await find(query)
      .limit(parsedLimit || undefined)
      .select('-__v');

    const formatted = clients.map(c => ({
      ...c.toObject(),
      address:     `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.address)}`,
      displayName: `${c.name} (${c.location})`,
    }));

    res.json(formatted);
  } catch (err) {
    next(err);
  }
};

// POST /clients
const addClient = async (req, res, next) => {
  try {
    const { name, contactPerson, email, phone, address, location, notes } = req.body;
    const client = await create({ name, contactPerson, email, phone, address, location, notes });
    res.status(201).json(client);
  } catch (err) {
    next(err);
  }
};

// GET /clients/client-names
const getClientNames = async (req, res, next) => {
  try {
    const clients = await find({}, 'name');
    res.json(clients.map(c => ({ value: c.name, name: c.name })));
  } catch (err) {
    next(err);
  }
};

// GET /clients/unique-locations
const getUniqueLocations = async (req, res, next) => {
  try {
    const locations = await distinct('location');
    res.json(['All', ...locations]);
  } catch (err) {
    next(err);
  }
};

// GET /clients/:id
const getClientById = async (req, res, next) => {
  try {
    const client = await findById(req.params.id);
    if (!client) return next(createError(404, 'Client not found'));
    res.json(client);
  } catch (err) {
    next(err);
  }
};

// GET /clients/geocode?address=...
const getGeocodedAddress = async (req, res, next) => {
  try {
    const { address } = req.query;
    if (!address) return next(createError(400, 'Address is required'));

    const apiKey  = process.env.GOOGLE_MAPS_API_KEY;
    const { data } = await get(
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

export default { getClients, addClient, getClientNames, getUniqueLocations, getClientById, getGeocodedAddress };
