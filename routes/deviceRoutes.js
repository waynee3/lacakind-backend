const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/deviceController');

// Specific paths before param routes
router.get('/bulk-operations',     auth, c.getBulkOperations);
router.get('/all-bulk-operations', auth, c.getAllBulkOperations);
router.get('/serial/:serialNumber',auth, c.getDeviceBySerialNumber);
router.put('/serial/:serialNumber',auth, c.updateDeviceBySerialNumber);
router.post('/bulk-lifecycle',     auth, ...c.bulkLogLifecycleEvent);

router.get('/',    auth, c.getDevices);
router.post('/',   auth, c.addDevice);
router.put('/:id', auth, c.updateDevice);
router.delete('/:id', auth, c.deleteDevice);

module.exports = router;
