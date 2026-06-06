import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth.js';
import { getClientNames, getUniqueLocations, getGeocodedAddress, getClients, addClient, getClientById } from '../controllers/clientController.js';

// NOTE: specific paths MUST come before /:id to avoid being swallowed by the param route
router.get('/client-names',      auth, getClientNames);
router.get('/unique-locations',  auth, getUniqueLocations);
router.get('/geocode',           auth, getGeocodedAddress);

router.get('/',    auth, getClients);
router.post('/',   auth, addClient);
router.get('/:id', auth, getClientById);

export default router;
