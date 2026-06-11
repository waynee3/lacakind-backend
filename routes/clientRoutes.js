import { Router } from 'express';
const router = Router();
import auth from '../middleware/auth.js';
import {
  getClientNames,
  getUniqueLocations,
  getGeocodedAddress,
  getClients,
  addClient,
  updateClient,
  deleteClient,
  getClientById,
} from '../controllers/clientController.js';

router.get('/client-names',     auth, getClientNames);
router.get('/unique-locations', auth, getUniqueLocations);
router.get('/geocode',          auth, getGeocodedAddress);

router.get('/',       auth, getClients);
router.post('/',      auth, addClient);
router.get('/:id',    auth, getClientById);
router.put('/:id',    auth, updateClient);
router.delete('/:id', auth, deleteClient);

export default router;