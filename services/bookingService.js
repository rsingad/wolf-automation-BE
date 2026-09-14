const Appointment = require('../models/Appointment');
const Customer = require('../models/Customer');

/**
 * Parses [CREATE_BOOKING: Service | Date | Time] tag from AI response.
 * - Prevents duplicate active bookings per customer.
 * - Returns { appointment, alreadyExists, existingBooking } so aiService can send appropriate reply.
 */
async function processBookingTag(tenantId, customerId, tagContent) {
  try {
    const parts = tagContent.split('|').map(p => p.trim());
    const serviceName = parts[0] || 'General Booking';
    const dateStr    = parts[1] || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr    = parts[2] || '10:00'; // HH:MM

    const customer = await Customer.findById(customerId);
    if (!customer) throw new Error('Customer not found');

    // Check for existing ACTIVE booking for this customer (PENDING or CONFIRMED)
    const existingBooking = await Appointment.findOne({
      tenantId,
      customerId,
      status: { $in: ['PENDING', 'CONFIRMED'] }
    });

    if (existingBooking) {
      console.log(`[Booking Service] Customer ${customer.name} already has active booking on ${existingBooking.date} at ${existingBooking.time}. Skipping duplicate.`);
      return { appointment: null, alreadyExists: true, existingBooking };
    }

    // Compute a real Date object for cron queries
    const bookingDate = new Date(`${dateStr}T${timeStr}:00`);

    const appointment = await Appointment.create({
      tenantId,
      customerId,
      customerName:  customer.name || 'WhatsApp User',
      customerPhone: customer.whatsappNumber,
      serviceName,
      date:          dateStr,
      time:          timeStr,
      bookingDate,
      status:        'CONFIRMED',
      reminderSent:  false,
      notes:         'Auto-booked via WhatsApp AI Assistant'
    });

    console.log(`[Booking Service] ✅ Appointment created for ${customer.name} on ${dateStr} at ${timeStr}`);
    return { appointment, alreadyExists: false, existingBooking: null };
  } catch (error) {
    console.error('[Booking Service] Error creating appointment:', error.message);
    return { appointment: null, alreadyExists: false, existingBooking: null };
  }
}

/**
 * Cancel an existing CONFIRMED/PENDING appointment.
 */
async function cancelBooking(appointmentId) {
  return Appointment.findByIdAndUpdate(
    appointmentId,
    { status: 'CANCELLED' },
    { returnDocument: 'after' }
  );
}

/**
 * Reschedule an existing appointment to a new date/time.
 */
async function rescheduleBooking(appointmentId, newDateStr, newTimeStr) {
  const bookingDate = new Date(`${newDateStr}T${newTimeStr}:00`);
  return Appointment.findByIdAndUpdate(
    appointmentId,
    { date: newDateStr, time: newTimeStr, bookingDate, reminderSent: false, status: 'CONFIRMED' },
    { returnDocument: 'after' }
  );
}

/**
 * Master AI Action Tag Parser — call this in queueManager BEFORE sending message.
 * Handles [CANCEL_BOOKING] and [RESCHEDULE_BOOKING: YYYY-MM-DD HH:MM]
 * Returns { cleanedText } with tags stripped out (so customer only sees natural text).
 *
 * @param {string} tenantId
 * @param {string} customerId
 * @param {string} aiText  — raw AI reply containing potential action tags
 * @returns {Promise<string>} cleaned text with tags removed
 */
async function processActionTags(tenantId, customerId, aiText) {
  let text = aiText;

  // ── CANCEL_BOOKING ────────────────────────────────────────────────────────
  if (/\[CANCEL_BOOKING\]/i.test(text)) {
    try {
      const cancelled = await Appointment.findOneAndUpdate(
        { tenantId, customerId, status: { $in: ['PENDING', 'CONFIRMED'] } },
        { status: 'CANCELLED' },
        { returnDocument: 'after' }
      );
      if (cancelled) {
        console.log(`[Booking Service] ❌ Appointment cancelled for customer ${customerId}: ${cancelled.date} ${cancelled.time}`);
      } else {
        console.warn(`[Booking Service] CANCEL_BOOKING tag found but no active appointment for customer ${customerId}`);
      }
    } catch (err) {
      console.error('[Booking Service] Error cancelling appointment:', err.message);
    }
    // Strip tag from reply
    text = text.replace(/\[CANCEL_BOOKING\]/gi, '').trim();
  }

  // ── RESCHEDULE_BOOKING ────────────────────────────────────────────────────
  const rescheduleMatch = text.match(/\[RESCHEDULE_BOOKING:\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\]/i);
  if (rescheduleMatch) {
    const newDateStr = rescheduleMatch[1]; // YYYY-MM-DD
    const newTimeStr = rescheduleMatch[2]; // HH:MM
    try {
      const bookingDate = new Date(`${newDateStr}T${newTimeStr}:00`);
      const rescheduled = await Appointment.findOneAndUpdate(
        { tenantId, customerId, status: { $in: ['PENDING', 'CONFIRMED'] } },
        { date: newDateStr, time: newTimeStr, bookingDate, status: 'CONFIRMED', reminderSent: false },
        { returnDocument: 'after' }
      );
      if (rescheduled) {
        console.log(`[Booking Service] 🔄 Appointment rescheduled for customer ${customerId} to ${newDateStr} at ${newTimeStr}`);
      } else {
        console.warn(`[Booking Service] RESCHEDULE_BOOKING tag found but no active appointment for customer ${customerId}`);
      }
    } catch (err) {
      console.error('[Booking Service] Error rescheduling appointment:', err.message);
    }
    // Strip tag from reply
    text = text.replace(/\[RESCHEDULE_BOOKING:\s*[\d\-]+\s+[\d:]+\]/gi, '').trim();
  }

  // ── SAVE_FACT (Long-Term Memory Auto-Appender) ────────────────────────────
  const factMatch = text.match(/\[SAVE_FACT:\s*([^\]]+)\]/i);
  if (factMatch) {
    const newFact = factMatch[1].trim();
    try {
      const cust = await Customer.findById(customerId);
      if (cust) {
        let existingSummary = cust.memorySummary ? cust.memorySummary.trim() : '';
        if (!existingSummary.includes(newFact)) {
          cust.memorySummary = existingSummary ? `${existingSummary} | ${newFact}` : newFact;
          await cust.save();
          console.log(`[Memory Engine] 🧠 Automatically saved new long-term fact for ${cust.name}: "${newFact}"`);
        }
      }
    } catch (mErr) {
      console.error('[Memory Engine] Error saving memory fact:', mErr.message);
    }
    text = text.replace(/\[SAVE_FACT:\s*[^\]]+\]/gi, '').trim();
  }

  // ── UPDATE_MOOD (Dynamic Emotion Tracker) ─────────────────────────────────
  const moodMatch = text.match(/\[UPDATE_MOOD:\s*([A-Z_]+)\s*\|\s*([^\]]+)\]/i);
  if (moodMatch) {
    const newMood = moodMatch[1].trim();
    const sentimentDesc = moodMatch[2].trim();
    try {
      const cust = await Customer.findById(customerId);
      if (cust) {
        cust.currentMood = newMood;
        cust.detectedSentiment = sentimentDesc;
        cust.lastEmotionUpdate = new Date();
        await cust.save();
        console.log(`[Emotion Engine] 🎭 Updated mood for ${cust.name}: ${newMood} (${sentimentDesc})`);
      }
    } catch (eErr) {
      console.error('[Emotion Engine] Error updating mood:', eErr.message);
    }
    text = text.replace(/\[UPDATE_MOOD:\s*[^\]]+\]/gi, '').trim();
  }

  return text;
}

module.exports = {
  processBookingTag,
  processActionTags,
  cancelBooking,
  rescheduleBooking
};
