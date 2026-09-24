const axios = require('axios');

/**
 * 🕸️ Deep Multi-Page AI Business Knowledge Base Scraper
 * Extracts comprehensive text, headers, footers, services, pricing, and key subpages.
 * @param {string} url Target website URL to scrape
 * @returns {Promise<string>} Rich structured extracted text for AI Knowledge Vault
 */
exports.scrapeWebsiteContent = async (url) => {
  try {
    let targetUrl = url.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    const fetchPageText = async (pageUrl) => {
      try {
        const response = await axios.get(pageUrl, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8'
          }
        });

        const html = response.data;
        if (typeof html !== 'string') return { cleanText: '', subPageLinks: [] };

        // Extract internal links for sub-pages (About Us, Services, Pricing, Contact, FAQ)
        const subPageLinks = [];
        const linkRegex = /href=["']([^"']+)["']/gi;
        let match;
        let origin = '';
        try {
          origin = new URL(pageUrl).origin;
        } catch (e) {
          origin = pageUrl;
        }

        while ((match = linkRegex.exec(html)) !== null) {
          const href = match[1];
          if (/about|service|price|pricing|contact|faq|feature|solution|product/i.test(href)) {
            try {
              const fullUrl = new URL(href, origin).href;
              if (fullUrl.startsWith(origin) && !subPageLinks.includes(fullUrl) && fullUrl !== pageUrl) {
                subPageLinks.push(fullUrl);
              }
            } catch (e) {}
          }
        }

        // Preserve text content from headers, footers, tables, lists, and paragraphs (don't strip headers/footers)
        let cleanText = html
          .replace(/<script\b[^<]*>([\s\S]*?)<\/script>/gi, '') // Remove scripts
          .replace(/<style\b[^<]*>([\s\S]*?)<\/style>/gi, '')   // Remove CSS
          .replace(/<svg\b[^<]*>([\s\S]*?)<\/svg>/gi, '')       // Remove SVGs
          .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n### $1\n') // Headers
          .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')           // Paragraphs
          .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n• $1')           // Lists
          .replace(/<td[^>]*>(.*?)<\/td>/gi, ' $1 |')           // Tables
          .replace(/<tr[^>]*>(.*?)<\/tr>/gi, '\n| $1')
          .replace(/<div[^>]*>(.*?)<\/div>/gi, '\n$1')           // Div text
          .replace(/<[^>]+>/g, ' ')                             // Strip HTML tags
          .replace(/&nbsp;/gi, ' ')
          .replace(/&amp;/gi, '&')
          .replace(/&lt;/gi, '<')
          .replace(/&gt;/gi, '>')
          .replace(/&#39;/gi, "'")
          .replace(/&quot;/gi, '"')
          .replace(/\s+/g, ' ')                                 // Collapse whitespace
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 5)                      // Keep shorter meaningful lines (pricing, bullet points)
          .join('\n');

        return { cleanText, subPageLinks: subPageLinks.slice(0, 3) }; // Top 3 subpages
      } catch (err) {
        console.warn(`[Page Scrape Warning] Could not fetch ${pageUrl}:`, err.message);
        return { cleanText: '', subPageLinks: [] };
      }
    };

    // 1. Scrape Main Homepage
    console.log(`[Deep Scraper] Scraping main homepage: ${targetUrl}...`);
    const mainResult = await fetchPageText(targetUrl);
    let aggregatedContent = `=== MAIN WEBSITE CONTENT (${targetUrl}) ===\n${mainResult.cleanText}`;

    // 2. Scrape Sub-Pages (About Us, Services, Pricing, Contact)
    if (mainResult.subPageLinks.length > 0) {
      console.log(`[Deep Scraper] Found ${mainResult.subPageLinks.length} key sub-pages to crawl:`, mainResult.subPageLinks);
      for (const subUrl of mainResult.subPageLinks) {
        console.log(`[Deep Scraper] Crawling subpage: ${subUrl}...`);
        const subResult = await fetchPageText(subUrl);
        if (subResult.cleanText && subResult.cleanText.length > 30) {
          aggregatedContent += `\n\n=== SUBPAGE CONTENT (${subUrl}) ===\n${subResult.cleanText}`;
        }
      }
    }

    // Limit extracted knowledge chunk size to 30,000 characters (2x capacity for deep knowledge)
    if (aggregatedContent.length > 30000) {
      aggregatedContent = aggregatedContent.substring(0, 30000) + '\n\n[...Deep Knowledge Content Truncated at 30k chars...]';
    }

    if (!aggregatedContent || aggregatedContent.length < 50) {
      throw new Error('Could not extract readable text content from website. Please ensure URL is publicly accessible.');
    }

    console.log(`[Deep Scraper] Successfully extracted ${aggregatedContent.length.toLocaleString()} characters of deep business knowledge!`);
    return aggregatedContent;
  } catch (error) {
    console.error(`[Web Scraper Error] Failed to scrape ${url}:`, error.message);
    throw new Error(`Failed to scrape website: ${error.message}`);
  }
};
