const ScheduledScrapeJob = require('../models/ScheduledScrapeJob');
const SavedLead = require('../models/SavedLead');
const { scrapeGoogleMapsLeads } = require('../services/googleMapsScraperService');
const { generateAIKeywords } = require('../services/aiLeadResearchService');

// ➕ Create a Scheduled Overnight / AI Prompt Scrape Job
exports.createScheduledJob = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const { title, mode, promptInput, keywords, cities, scheduleTime } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Job title is required' });
    }

    let finalKeywords = keywords || [];

    // If Mode is AI Prompt, generate 10x target keywords using LLM AI
    if (mode === 'ai_prompt' && promptInput) {
      const city = (cities && cities.length > 0) ? cities[0] : 'Jaipur';
      finalKeywords = await generateAIKeywords(promptInput, city);
    }

    if (finalKeywords.length === 0) {
      return res.status(400).json({ error: 'Please enter keywords or provide a target audience prompt' });
    }

    const job = await ScheduledScrapeJob.create({
      tenantId,
      title,
      mode: mode || 'keywords',
      promptInput: promptInput || '',
      keywords: finalKeywords,
      cities: cities && cities.length > 0 ? cities : ['Jaipur'],
      scheduleTime: scheduleTime || '02:00',
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message: `🎉 Scheduled Scrape Job created! Generated ${finalKeywords.length} sub-targeted keywords.`,
      job
    });
  } catch (err) {
    console.error('Error creating scheduled scrape job:', err);
    res.status(500).json({ error: 'Failed to create scheduled scrape job' });
  }
};

// 📋 Get all Scheduled Jobs for tenant
exports.getScheduledJobs = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const jobs = await ScheduledScrapeJob.find({ tenantId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch scheduled jobs' });
  }
};

// 🚀 Manual Immediate Run for Scheduled Job (Overnight Run Preview)
exports.runJobImmediately = async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await ScheduledScrapeJob.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Scheduled Job not found' });
    }

    job.status = 'running';
    await job.save();

    let totalHarvested = 0;

    // Process keywords one-by-one
    for (const city of job.cities) {
      for (const kw of job.keywords) {
        try {
          console.log(`[Scheduled Overnight Job: ${job.title}] Processing keyword "${kw}" in "${city}"...`);
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
          console.warn(`[Scheduled Job Error for "${kw}"]:`, kwErr.message);
        }
      }
    }

    job.status = 'completed';
    job.processedCount = job.keywords.length * job.cities.length;
    job.totalLeadsHarvested += totalHarvested;
    job.lastRunAt = new Date();
    await job.save();

    res.status(200).json({
      success: true,
      message: `🎉 Batch Overnight Execution Finished! Harvested ${totalHarvested} new leads.`,
      job
    });
  } catch (err) {
    console.error('Error running scheduled job:', err);
    res.status(500).json({ error: 'Failed to execute scheduled job' });
  }
};

// 🗑️ Delete Scheduled Job
exports.deleteJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    await ScheduledScrapeJob.findByIdAndDelete(jobId);
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete job' });
  }
};
