const Customer = require('../../models/Customer');
const Message = require('../../models/Message');
const Appointment = require('../../models/Appointment');
const UsageLog = require('../../models/UsageLog');

/**
 * Merges duplicate LID customer records into parent phone number customer records.
 * Transfers all messages, appointments, usage logs, and deletes duplicate LID record.
 */
async function mergeLidIntoPhoneCustomer(tenantId, phoneJid, lidJid, name) {
  if (!phoneJid || !lidJid || phoneJid === lidJid) return null;

  try {
    // 1. Find Phone Customer
    let phoneCustomer = await Customer.findOne({
      tenantId,
      $or: [{ whatsappNumber: phoneJid }, { aliasIds: phoneJid }]
    });

    // 2. Find LID Customer
    let lidCustomer = await Customer.findOne({
      tenantId,
      $or: [{ whatsappNumber: lidJid }, { aliasIds: lidJid }]
    });

    // Case A: Both exist as separate DB documents -> MERGE THEM!
    if (phoneCustomer && lidCustomer && phoneCustomer._id.toString() !== lidCustomer._id.toString()) {
      console.log(`[Auto-Merger] Merging duplicate LID Customer (${lidCustomer.whatsappNumber}) into Phone Customer (${phoneCustomer.whatsappNumber})...`);

      // Transfer all child records
      await Message.updateMany({ customerId: lidCustomer._id }, { customerId: phoneCustomer._id });
      await Appointment.updateMany({ customerId: lidCustomer._id }, { customerId: phoneCustomer._id });
      await UsageLog.updateMany({ customerId: lidCustomer._id }, { customerId: phoneCustomer._id });

      // Add LID to phone customer's aliasIds
      if (!phoneCustomer.aliasIds.includes(lidJid)) {
        phoneCustomer.aliasIds.push(lidJid);
      }
      if (name && (!phoneCustomer.name || phoneCustomer.name.startsWith('+') || phoneCustomer.name.includes('WhatsApp User'))) {
        phoneCustomer.name = name;
      }
      await phoneCustomer.save();

      // Delete the duplicate LID customer record
      await Customer.findByIdAndDelete(lidCustomer._id);
      console.log(`[Auto-Merger] Successfully merged and removed duplicate LID Customer ${lidCustomer._id}.`);
      return phoneCustomer;
    }

    // Case B: Only Phone Customer exists -> Add LID to aliasIds
    if (phoneCustomer) {
      if (!phoneCustomer.aliasIds.includes(lidJid)) {
        phoneCustomer.aliasIds.push(lidJid);
        await phoneCustomer.save();
      }
      return phoneCustomer;
    }

    // Case C: Only LID Customer exists -> Upgrade LID Customer to Phone Customer
    if (lidCustomer) {
      lidCustomer.whatsappNumber = phoneJid;
      if (!lidCustomer.aliasIds.includes(lidJid)) {
        lidCustomer.aliasIds.push(lidJid);
      }
      if (name && !name.includes('Private ID') && !name.includes('WhatsApp User')) {
        lidCustomer.name = name;
      }
      await lidCustomer.save();
      return lidCustomer;
    }

    // Case D: Neither exists -> Create unified customer
    return await Customer.create({
      tenantId,
      whatsappNumber: phoneJid,
      aliasIds: [lidJid],
      name: name || `+${phoneJid.split('@')[0]}`
    });
  } catch (err) {
    console.error('[Auto-Merger] Error in mergeLidIntoPhoneCustomer:', err.message);
    return null;
  }
}

/**
 * Scan database for any orphaned LID customers that match phone contacts by pushName or alias
 */
async function cleanupDuplicateLidCustomers(tenantId) {
  try {
    const lidCustomers = await Customer.find({ tenantId, whatsappNumber: /@lid$/ });
    for (const lidCust of lidCustomers) {
      if (!lidCust.name || lidCust.name.includes('WhatsApp User') || lidCust.name.includes('Private ID')) continue;

      // Try to find a matching phone number customer with same name
      const phoneCust = await Customer.findOne({
        tenantId,
        name: lidCust.name,
        whatsappNumber: { $not: /@lid$/ },
        _id: { $ne: lidCust._id }
      });

      if (phoneCust) {
        await mergeLidIntoPhoneCustomer(tenantId, phoneCust.whatsappNumber, lidCust.whatsappNumber, phoneCust.name);
      }
    }
  } catch (err) {
    console.error('[Auto-Merger] Error in cleanupDuplicateLidCustomers:', err.message);
  }
}

module.exports = {
  mergeLidIntoPhoneCustomer,
  cleanupDuplicateLidCustomers
};
