import { Router } from 'express';
const router = Router();
import auth from '../middleware/auth.js';
import { getDashboardStats } from '../controllers/dashboardController.js';

router.get('/stats', auth, getDashboardStats);

export default router;