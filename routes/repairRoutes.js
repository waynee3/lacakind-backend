import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth.js';
import { createRepairIncident, getRepairIncidents, updateRepairIncident, deploySpareUnit } from '../controllers/repairController.js';

router.post('/',          auth, createRepairIncident);
router.get('/',           auth, getRepairIncidents);
router.put('/:id',        auth, updateRepairIncident);
router.post('/:id/spare', auth, deploySpareUnit);

export default router;
