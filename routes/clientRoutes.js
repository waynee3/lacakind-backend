const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/clientController');

// NOTE: specific paths MUST come before /:id to avoid being swallowed by the param route
router.get('/client-names',      auth, c.getClientNames);
router.get('/unique-locations',  auth, c.getUniqueLocations);
router.get('/geocode',           auth, c.getGeocodedAddress);

router.get('/',    auth, c.getClients);
router.post('/',   auth, c.addClient);
router.get('/:id', auth, c.getClientById);

module.exports = router;
