const express = require('express');
const router  = express.Router();
const appointmentController = require('../controllers/appointmentController');

router.get('/:tenantId',         appointmentController.getAppointments);
router.post('/',                 appointmentController.createAppointment);
router.put('/:id/status',        appointmentController.updateStatus);
router.put('/:id/reschedule',    appointmentController.rescheduleAppointment);
router.delete('/:id',            appointmentController.deleteAppointment);

module.exports = router;
