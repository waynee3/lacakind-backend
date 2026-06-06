import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth.js';
import { getContracts, addContract, updateDevicesForContract, getContractById, updateContract, terminateContract, bulkUploadDocuments } from '../controllers/contractController.js';

router.get('/',                  auth, getContracts);
router.post('/',                 auth, addContract);
router.post('/update-devices', auth, updateDevicesForContract);
router.get('/:id',               auth, getContractById);
router.put('/:id',               auth, updateContract);
router.put('/:id/terminate',     auth, terminateContract);
router.post('/:id/documents',    auth, bulkUploadDocuments);

export default router;
