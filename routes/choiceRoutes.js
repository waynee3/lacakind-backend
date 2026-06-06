import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth.js';
import { getChoices, addChoice, deleteChoice } from '../controllers/choiceController.js';

router.get('/',    auth, getChoices);
router.post('/',   auth, addChoice);
router.delete('/:id', auth, deleteChoice);

export default router;
