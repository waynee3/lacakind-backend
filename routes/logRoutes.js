import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth';
import { addLog, getLogs, updateLog, deleteLog } from '../controllers/logController';

router.post('/:serialNumber', auth, addLog);
router.get('/',               auth, getLogs);
router.put('/',               auth, updateLog);
router.delete('/',            auth, deleteLog);

export default router;
