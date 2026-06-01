const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/repairController');

router.post('/',          auth, c.createRepairIncident);
router.get('/',           auth, c.getRepairIncidents);
router.put('/:id',        auth, c.updateRepairIncident);
router.post('/:id/spare', auth, c.deploySpareUnit);

module.exports = router;
