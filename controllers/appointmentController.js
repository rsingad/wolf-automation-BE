const Appointment = require('../models/Appointment');

const VALID_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'];

// GET all appointments for a Tenant
exports.getAppointments = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const appointments = await Appointment.find({ tenantId })
      .sort({ date: 1, time: 1 })
      .lean();

    res.status(200).json({ success: true, appointments });
  } catch (error) {
    console.error('[Appointments] Error fetching:', error);
    res.status(500).json({ error: 'Server error fetching appointments' });
  }
};

// POST — Manual appointment creation from dashboard
exports.createAppointment = async (req, res) => {
  try {
    const { tenantId, customerName, customerPhone, serviceName, date, time, notes, customerId } = req.body;

    const bookingDate = date && time ? new Date(`${date}T${time}:00`) : undefined;

    const appointment = await Appointment.create({
      tenantId,
      customerId: customerId || tenantId,
      customerName,
      customerPhone,
      serviceName:  serviceName || 'General Consultation',
      date,
      time,
      bookingDate,
      status:       'CONFIRMED',
      reminderSent: false,
      notes:        notes || 'Manual Booking'
    });

    res.status(201).json({ success: true, appointment });
  } catch (error) {
    console.error('[Appointments] Error creating:', error);
    res.status(500).json({ error: 'Server error creating appointment' });
  }
};

// PUT /:id/status — Update appointment status (PENDING → CONFIRMED → COMPLETED / CANCELLED)
exports.updateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`
      });
    }

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { status },
      { returnDocument: 'after' }
    );

    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    res.status(200).json({ success: true, appointment });
  } catch (error) {
    console.error('[Appointments] Error updating status:', error);
    res.status(500).json({ error: 'Server error updating appointment status' });
  }
};

// PUT /:id/reschedule — Reschedule to new date/time
exports.rescheduleAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, time } = req.body;

    if (!date || !time) {
      return res.status(400).json({ error: 'date and time are required for rescheduling' });
    }

    const bookingDate = new Date(`${date}T${time}:00`);

    const appointment = await Appointment.findByIdAndUpdate(
      id,
      { date, time, bookingDate, status: 'CONFIRMED', reminderSent: false },
      { returnDocument: 'after' }
    );

    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    res.status(200).json({ success: true, appointment });
  } catch (error) {
    console.error('[Appointments] Error rescheduling:', error);
    res.status(500).json({ error: 'Server error rescheduling appointment' });
  }
};

// DELETE /:id — Remove an appointment
exports.deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;
    await Appointment.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: 'Appointment deleted' });
  } catch (error) {
    console.error('[Appointments] Error deleting:', error);
    res.status(500).json({ error: 'Server error deleting appointment' });
  }
};
