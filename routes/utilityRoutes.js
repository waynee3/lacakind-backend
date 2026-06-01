const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/utilityController');

router.post('/bulk-import',  auth, ...c.bulkImport);
router.post('/bulk-update',  auth, c.bulkUpdate);
router.get('/bulk-operations', auth, c.getBulkOperations);
router.get('/reports',       auth, c.generateReports);

module.exports = router;
