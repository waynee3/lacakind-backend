import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth.js';
import { getBulkOperations, getAllBulkOperations, getDeviceBySerialNumber, updateDeviceBySerialNumber, bulkLogLifecycleEvent, getDevices, addDevice, updateDevice, deleteDevice } from '../controllers/deviceController.js';

// Specific paths before param routes
router.get('/bulk-operations',     auth, getBulkOperations);
router.get('/all-bulk-operations', auth, getAllBulkOperations);
router.get('/serial/:serialNumber',auth, getDeviceBySerialNumber);
router.put('/serial/:serialNumber',auth, updateDeviceBySerialNumber);
router.post('/bulk-lifecycle',     auth, ...bulkLogLifecycleEvent);

router.get('/',    auth, getDevices);
router.post('/',   auth, addDevice);
router.put('/:id', auth, updateDevice);
router.delete('/:id', auth, deleteDevice);

export default router;
