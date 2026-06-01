const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/logController');

router.post('/:serialNumber', auth, c.addLog);
router.get('/',               auth, c.getLogs);
router.put('/',               auth, c.updateLog);
router.delete('/',            auth, c.deleteLog);

module.exports = router;
