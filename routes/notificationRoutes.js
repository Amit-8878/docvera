const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  getNotifications,
  postNotification,
  markNotificationReadById,
  markNotificationsRead,
  deleteNotification,
  getSettings,
  updateSettings,
  getTemplates,
  saveTemplate,
  getNotificationLogs,
} = require('../controllers/notificationController');

const router = express.Router();

router.get('/', authMiddleware, getNotifications);
router.post('/', authMiddleware, postNotification);
router.patch('/read/:id', authMiddleware, markNotificationReadById);
router.put('/read', authMiddleware, markNotificationsRead);
router.delete('/:id', authMiddleware, deleteNotification);
router.get('/settings', authMiddleware, getSettings);
router.put('/settings', authMiddleware, updateSettings);
router.get('/templates', authMiddleware, getTemplates);
router.put('/templates', authMiddleware, saveTemplate);
router.get('/logs', authMiddleware, getNotificationLogs);

module.exports = router;

