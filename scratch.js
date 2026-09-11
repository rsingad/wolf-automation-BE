const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const Message = require('./models/Message');

const MONGODB_URI = 'mongodb://127.0.0.1:27017/whatsapp-saas';

async function runMigration() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    const lidCustomers = await Customer.find({ whatsappNumber: { $regex: '@lid$' } });
    console.log(`Found ${lidCustomers.length} LID customers to investigate.`);

    for (const lidCustomer of lidCustomers) {
      if (!lidCustomer.name || lidCustomer.name === 'Unknown User') continue;

      const realCustomers = await Customer.find({ 
        tenantId: lidCustomer.tenantId, 
        name: lidCustomer.name, 
        whatsappNumber: { $not: { $regex: '@lid$' } } 
      });

      if (realCustomers.length === 1) {
        const targetCustomer = realCustomers[0];
        console.log(`Merging ${lidCustomer.name} (${lidCustomer.whatsappNumber}) into ${targetCustomer.whatsappNumber}`);

        if (!targetCustomer.aliasIds.includes(lidCustomer.whatsappNumber)) {
          targetCustomer.aliasIds.push(lidCustomer.whatsappNumber);
          await targetCustomer.save();
        }

        await Message.updateMany(
          { customerId: lidCustomer._id },
          { $set: { customerId: targetCustomer._id } }
        );

        await Customer.findByIdAndDelete(lidCustomer._id);
        console.log(`Merge complete for ${lidCustomer.name}`);
      }
    }

    console.log('Migration finished.');
  } catch (err) {
    console.error('Error during migration:', err);
  } finally {
    await mongoose.disconnect();
  }
}

runMigration();
