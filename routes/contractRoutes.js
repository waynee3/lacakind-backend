const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const c       = require('../controllers/contractController');

router.get('/',                  auth, c.getContracts);
router.post('/',                 auth, c.addContract);
router.post('/update-kiosks',        c.updateKiosksForContract); // internal, no auth per original
router.get('/:id',               auth, c.getContractById);
router.put('/:id',               auth, c.updateContract);
router.put('/:id/terminate',     auth, c.terminateContract);
router.post('/:id/documents',    auth, c.bulkUploadDocuments);

module.exports = router;
