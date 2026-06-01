const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/choiceController');

router.get('/',    auth, c.getChoices);
router.post('/',   auth, c.addChoice);
router.delete('/:id', auth, c.deleteChoice);

module.exports = router;
