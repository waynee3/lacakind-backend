const escapeRegex = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
import axios from 'axios';
import Client from '../models/Client.js';
import { createError } from '../middleware/errorHandler.js';

// GET /clients
const getClients = async (req, res, next) => {
  try {
    const { search, location, limit } = req.query;
    const query = { owner: req.user.id };

    if (search) query.name = { $regex: escapeRegex(search), $options: 'i' };
    if (location && location !== 'All') query.location = location;

    const parsedLimit = parseInt(limit) || 0;
    const clients = await Client.find(query)
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
    const client = await Client.create({
      owner: req.user.id,
      name, contactPerson, email, phone, address, location, notes,
    });
    res.status(201).json(client);
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

// GET /clients/geocode?address=...
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

export { getClients, addClient, getClientNames, getUniqueLocations, getClientById, getGeocodedAddress };