const express = require('express');
const router = express.Router();

const serviceController = require('../modules/services/service.controller');
const authMiddleware = require('../middleware/authMiddleware');
const optionalAuthMiddleware = require('../middleware/optionalAuthMiddleware');
const { adminOnly } = require('../middleware/adminMiddleware');
const { optionalServiceIconUpload } = require('../middleware/serviceIconUpload');

router.get('/search', optionalAuthMiddleware, serviceController.searchServices);

router.post('/', authMiddleware, adminOnly, optionalServiceIconUpload, serviceController.createService);

router.get('/test', (req, res) => {
  res.status(200).send('services router test ok');
});

router.patch('/toggle/:id', authMiddleware, adminOnly, serviceController.toggleService);

router.get('/:id', optionalAuthMiddleware, serviceController.getSingleService);
router.put('/:id', authMiddleware, adminOnly, serviceController.updateService);
router.delete('/:id', authMiddleware, adminOnly, serviceController.deleteService);

router.get('/', optionalAuthMiddleware, serviceController.getAllServices);

module.exports = router;
