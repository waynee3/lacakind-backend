import { Router } from 'express';
const router  = Router();
import auth from '../middleware/auth';
import { getChoices, addChoice, deleteChoice } from '../controllers/choiceController';

router.get('/',    auth, getChoices);
router.post('/',   auth, addChoice);
router.delete('/:id', auth, deleteChoice);

export default router;
