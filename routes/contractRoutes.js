import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth';
import { getContracts, addContract, updateKiosksForContract, getContractById, updateContract, terminateContract, bulkUploadDocuments } from '../controllers/contractController';

router.get('/',                  auth, getContracts);
router.post('/',                 auth, addContract);
router.post('/update-kiosks', auth, c.updateKiosksForContract);
router.get('/:id',               auth, getContractById);
router.put('/:id',               auth, updateContract);
router.put('/:id/terminate',     auth, terminateContract);
router.post('/:id/documents',    auth, bulkUploadDocuments);

export default router;
