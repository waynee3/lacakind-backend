import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth.js';
import { bulkImport, bulkUpdate, getBulkOperations, generateReports } from '../controllers/utilityController.js';

router.post('/bulk-import',  auth, ...bulkImport);
router.post('/bulk-update',  auth, bulkUpdate);
router.get('/bulk-operations', auth, getBulkOperations);
router.get('/reports',       auth, generateReports);

export default router;
