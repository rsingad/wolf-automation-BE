const axios = require('axios');

/**
 * Clean & Format phone number into clean WhatsApp compatible string
 */
function sanitizePhoneNumber(rawPhone) {
  if (!rawPhone) return '';
  let cleaned = String(rawPhone).replace(/[^0-9]/g, '');
  if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  if (cleaned.length >= 10 && cleaned.length <= 13) return cleaned;
  return '';
}

/**
 * Advanced Google Dorking & LinkedIn Executive Scraper Service
 * Executes targeted Google Dork queries like:
 * site:linkedin.com/in/ ("Hospital Owner" OR "Managing Director") AND ("Jaipur") AND ("Gmail" OR "Contact")
 */
exports.scrapeLinkedInDorks = async (dorkQuery) => {
  console.log(`[LinkedIn Dorking Scraper] Executing advanced query: "${dorkQuery}"...`);
  const results = [];

  try {
    let html = '';
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(dorkQuery)}`;
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 5000
      });
      html = response.data || '';
    } catch (eDDG) {
      try {
        const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(dorkQuery)}`;
        const resBing = await axios.get(bingUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 5000
        });
        html = resBing.data || '';
      } catch (eBing) {}
    }

    // Regex patterns for emails, phone numbers, and names
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g;

    const emailsFound = [...new Set(html.match(emailRegex) || [])].filter(e => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.includes('duckduckgo'));
    const phonesFound = [...new Set((html.match(phoneRegex) || []).map(p => sanitizePhoneNumber(p)).filter(Boolean))];

    // Extract title snippets (LinkedIn Profiles)
    const titleRegex = /<a class="result__url"[^>]*>[\s\S]*?<\/a>/gi;
    const profileLinks = [];
    const linkMatches = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/gi) || [];

    const uniqueProfiles = [...new Set(linkMatches)];

    const maxLen = Math.max(uniqueProfiles.length, emailsFound.length, phonesFound.length);
    for (let i = 0; i < maxLen; i++) {
      const profileUrl = uniqueProfiles[i] || "";
      const email = emailsFound[i] || "";
      const phone = phonesFound[i] || "";

      // Deriving name from URL slug
      let name = 'Executive Partner';
      if (uniqueProfiles[i]) {
        const parts = uniqueProfiles[i].split('/in/')[1]?.split('/')[0]?.replace(/-/g, ' ');
        if (parts) {
          name = parts.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }
      }

      results.push({
        businessName: name,
        phone,
        email,
        address: dorkQuery.includes('Jaipur') ? 'Jaipur, Rajasthan' : 'India Commercial Region',
        rating: 4.9,
        userRatingsTotal: 50,
        website: profileUrl,
        category: 'LinkedIn Executive / Owner',
        description: `Executive lead harvested via LinkedIn Dorking query: ${dorkQuery.slice(0, 60)}...`,
        socialLinks: {
          linkedin: profileUrl
        },
        engineChoice: 'dorking'
      });
    }
  } catch (err) {
    console.error(`[LinkedIn Dorking Error]: ${err.message}`);
  }

  console.log(`[LinkedIn Dorking Scraper] Extracted ${results.length} executive leads for dork: "${dorkQuery}"`);
  return results;
};
