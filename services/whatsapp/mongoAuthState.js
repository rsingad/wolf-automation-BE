const { BufferJSON, initAuthCreds, proto } = require('@whiskeysockets/baileys');
const BaileysAuth = require('../../models/BaileysAuth');

/**
 * MongoDB Auth State Store for Baileys Multi-Tenant WhatsApp Sessions.
 * Automatically saves credentials, keys, and session data into MongoDB,
 * eliminating dependency on local auth_info_baileys filesystem folders.
 * 
 * @param {string} tenantId 
 */
async function useMongoDBAuthState(tenantId) {
  const tId = tenantId.toString();

  // Helper to read key from MongoDB
  const readData = async (keyId) => {
    try {
      const doc = await BaileysAuth.findOne({ tenantId: tId, keyId });
      if (!doc || !doc.data) return null;
      
      const str = JSON.stringify(doc.data);
      return JSON.parse(str, BufferJSON.reviver);
    } catch (error) {
      console.error(`[MongoAuth] Read error for ${keyId}:`, error.message);
      return null;
    }
  };

  // Helper to write key to MongoDB
  const writeData = async (keyId, data) => {
    try {
      if (data === null || data === undefined) {
        await BaileysAuth.deleteOne({ tenantId: tId, keyId });
      } else {
        const json = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        await BaileysAuth.findOneAndUpdate(
          { tenantId: tId, keyId },
          { tenantId: tId, keyId, data: json },
          { upsert: true, new: true }
        );
      }
    } catch (error) {
      console.error(`[MongoAuth] Write error for ${keyId}:`, error.message);
    }
  };

  // Delete all keys for tenant (on logout or session reset)
  const clearState = async () => {
    try {
      await BaileysAuth.deleteMany({ tenantId: tId });
      console.log(`[MongoAuth] 🧹 Cleared all MongoDB auth keys for tenant ${tId}`);
    } catch (e) {
      console.error(`[MongoAuth] Clear error for tenant ${tId}:`, e.message);
    }
  };

  // Fetch or initialize auth creds
  const credsData = await readData('creds');
  const creds = credsData || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                try {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                } catch (e) {}
              }
              if (value) data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const keyId = `${category}-${id}`;
              tasks.push(writeData(keyId, value));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => {
      return writeData('creds', creds);
    },
    clearState
  };
}

module.exports = useMongoDBAuthState;
