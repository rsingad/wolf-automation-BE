const axios = require('axios');

/**
 * 🕸️ Scrapes textual knowledge base content from any public business website URL
 * @param {string} url Target website URL to scrape
 * @returns {Promise<string>} Clean extracted markdown text suitable for AI Knowledge Base
 */
exports.scrapeWebsiteContent = async (url) => {
  try {
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    const response = await axios.get(targetUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const html = response.data;
    if (typeof html !== 'string') {
      throw new Error('Invalid HTML content received from website');
    }

    // Clean HTML tags and extract readable text lines using regex parsing
    let cleanText = html
      .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '') // Remove scripts
      .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')   // Remove CSS styles
      .replace(/<header\b[^<]*>([\s\S]*?)<\/header>/gi, '') // Remove header nav
      .replace(/<footer\b[^<]*>([\s\S]*?)<\/footer>/gi, '') // Remove footer links
      .replace(/<nav\b[^<]*>([\s\S]*?)<\/nav>/gi, '')       // Remove nav tags
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n### $1\n') // Convert headers to markdown
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')           // Extract paragraphs
      .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n• $1')           // Extract bullet points
      .replace(/<[^>]+>/g, ' ')                             // Strip remaining HTML tags
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ')                                 // Collapse redundant whitespace
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 20)                     // Keep meaningful text lines
      .join('\n');

    // Limit extracted knowledge chunk size to 15,000 characters
    if (cleanText.length > 15000) {
      cleanText = cleanText.substring(0, 15000) + '\n\n[...Website Content Truncated...]';
    }

    if (!cleanText || cleanText.length < 50) {
      throw new Error('Could not extract readable text content from website. Please ensure URL is publicly accessible.');
    }

    return cleanText;
  } catch (error) {
    console.error(`[Web Scraper Error] Failed to scrape ${url}:`, error.message);
    throw new Error(`Failed to scrape website: ${error.message}`);
  }
};
