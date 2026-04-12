const express = require('express');

const serviceController = require('./service.controller');
const authMiddleware = require('../../middleware/authMiddleware');
const optionalAuthMiddleware = require('../../middleware/optionalAuthMiddleware');
const { adminOnly } = require('../../middleware/adminMiddleware');
const { requireServicesCatalogEnabled } = require('../../middleware/servicesCatalogMiddleware');
const { optionalServiceIconUpload } = require('../../middleware/serviceIconUpload');

const router = express.Router();

router.get('/', optionalAuthMiddleware, requireServicesCatalogEnabled, serviceController.getAllServices);
router.get('/search', optionalAuthMiddleware, requireServicesCatalogEnabled, serviceController.searchServices);
router.post('/', authMiddleware, adminOnly, optionalServiceIconUpload, serviceController.createService);

router.get('/test', (req, res) => {
  res.status(200).send('services router test ok');
});

router.patch('/toggle/:id', authMiddleware, adminOnly, serviceController.toggleService);

router.get('/:id', optionalAuthMiddleware, requireServicesCatalogEnabled, serviceController.getSingleService);
router.put('/:id', authMiddleware, adminOnly, serviceController.updateService);
router.delete('/:id', authMiddleware, adminOnly, serviceController.deleteService);

module.exports = router;
