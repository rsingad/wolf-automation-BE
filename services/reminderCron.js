const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const { getActiveSession } = require('./whatsapp/connectionManager');

/**
 * Reminder Cron — Runs every 5 minutes.
 * Sends WhatsApp reminder to customers whose CONFIRMED appointment is within 30 minutes.
 */
function startReminderCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() + 10 * 60 * 1000);  // +10 mins
      const windowEnd   = new Date(now.getTime() + 35 * 60 * 1000);  // +35 mins

      const dueAppointments = await Appointment.find({
        status:        'CONFIRMED',
        reminderSent:  false,
        bookingDate:   { $gte: windowStart, $lte: windowEnd }
      });

      if (dueAppointments.length === 0) return;

      console.log(`[ReminderCron] Found ${dueAppointments.length} appointment(s) due for reminders.`);

      for (const appt of dueAppointments) {
        const tenantId = appt.tenantId.toString();
        const sock     = getActiveSession(tenantId);

        if (!sock || !sock.sendMessage) {
          console.warn(`[ReminderCron] No active WhatsApp session for tenant ${tenantId}. Skipping.`);
          continue;
        }

        const remoteJid = `${appt.customerPhone}@s.whatsapp.net`;
        const message   =
          `📅 *Appointment Reminder*\n\n` +
          `Haanji ${appt.customerName}, aapki appointment aane wali hai!\n\n` +
          `*Service:* ${appt.serviceName}\n` +
          `*Date:* ${appt.date}\n` +
          `*Time:* ${appt.time}\n\n` +
          `_Please be on time. Agar koi problem ho to abhi reply karein._`;

        try {
          await sock.sendMessage(remoteJid, { text: message });
          await Appointment.findByIdAndUpdate(appt._id, { reminderSent: true });
          console.log(`[ReminderCron] ✅ Reminder sent to ${appt.customerName} (${appt.customerPhone})`);
        } catch (sendErr) {
          console.error(`[ReminderCron] Error sending reminder to ${appt.customerPhone}:`, sendErr.message);
        }
      }
    } catch (err) {
      console.error('[ReminderCron] Cron error:', err.message);
    }
  });

  console.log('[ReminderCron] ⏰ Appointment reminder scheduler started (every 5 mins, 10-35 min window).');
}

module.exports = { startReminderCron };
