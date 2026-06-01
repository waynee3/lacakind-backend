import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth';
import { createRepairIncident, getRepairIncidents, updateRepairIncident, deploySpareUnit } from '../controllers/repairController';

router.post('/',          auth, createRepairIncident);
router.get('/',           auth, getRepairIncidents);
router.put('/:id',        auth, updateRepairIncident);
router.post('/:id/spare', auth, deploySpareUnit);

export default router;
