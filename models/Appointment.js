const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  tenantId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant',   required: true },
  customerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  customerName:  { type: String, default: 'WhatsApp User' },
  customerPhone: { type: String, required: true },
  serviceName:   { type: String, default: 'General Consultation' },
  date:          { type: String, required: true }, // YYYY-MM-DD (UI display)
  time:          { type: String, required: true }, // HH:MM
  bookingDate:   { type: Date },                   // Computed DateTime — used by reminder cron
  status: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
    default: 'CONFIRMED'
  },
  reminderSent:  { type: Boolean, default: false },
  notes:         { type: String, default: 'Booked automatically via WhatsApp AI Assistant' }
}, { timestamps: true });

module.exports = mongoose.model('Appointment', appointmentSchema);
