const cron = require('node-cron');
const ScheduledScrapeJob = require('../models/ScheduledScrapeJob');
const SavedLead = require('../models/SavedLead');
const { scrapeGoogleMapsLeads } = require('./googleMapsScraperService');

/**
 * Start Background Cron Scheduler for Overnight Batch Scrape Jobs
 * Runs every hour to check for scheduled jobs matching current hour
 */
exports.startScheduledScraperCron = () => {
  console.log('[ScheduledScraperCron] 🌙 Overnight Lead Scraper Cron initialized (Runs hourly check)...');

  cron.schedule('0 * * * *', async () => {
    try {
      const now = new Date();
      const currentHour = String(now.getHours()).padStart(2, '0');
      console.log(`[ScheduledScraperCron] Running hourly check at ${currentHour}:00...`);

      // Find pending jobs where scheduleTime hour matches
      const pendingJobs = await ScheduledScrapeJob.find({ status: 'pending' });

      for (const job of pendingJobs) {
        const jobHour = (job.scheduleTime || '02:00').split(':')[0];
        if (jobHour === currentHour || job.isOvernightBatch) {
          console.log(`[ScheduledScraperCron] 🚀 Triggering overnight job "${job.title}" for tenant ${job.tenantId}`);
          
          job.status = 'running';
          await job.save();

          let totalHarvested = 0;

          for (const city of job.cities) {
            for (const kw of job.keywords) {
              try {
                const leads = await scrapeGoogleMapsLeads(kw, city, 'playwright');

                for (const item of leads) {
                  const existing = await SavedLead.findOne({ tenantId: job.tenantId, phone: item.phone });
                  if (!existing) {
                    await SavedLead.create({
                      tenantId: job.tenantId,
                      query: kw,
                      businessName: item.businessName,
                      phone: item.phone,
                      address: item.address,
                      rating: item.rating,
                      userRatingsTotal: item.userRatingsTotal,
                      website: item.website,
                      email: item.email || '',
                      description: item.description || '',
                      socialLinks: item.socialLinks || {},
                      category: item.category,
                      status: 'new'
                    });
                    totalHarvested++;
                  }
                }
              } catch (kwErr) {
                console.warn(`[Scheduled Scraper Cron Error for "${kw}"]:`, kwErr.message);
              }
            }
          }

          job.status = 'completed';
          job.processedCount = job.keywords.length * job.cities.length;
          job.totalLeadsHarvested += totalHarvested;
          job.lastRunAt = new Date();
          await job.save();

          console.log(`[ScheduledScraperCron] ✅ Job "${job.title}" finished! Harvested ${totalHarvested} leads.`);
        }
      }
    } catch (err) {
      console.error('[ScheduledScraperCron Error]:', err.message);
    }
  });
};
