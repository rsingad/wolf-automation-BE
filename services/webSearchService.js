const axios = require('axios');

/**
 * Searches the web for live pricing, market rates, or web results via DuckDuckGo HTML
 */
async function searchWeb(query) {
  try {
    console.log(`[Web Search Service] Searching web for: "${query}"`);

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 5000
    });

    const html = response.data || '';
    
    // Extract snippets from DuckDuckGo HTML
    const snippets = [];
    const regex = /<a class="result__snippet[^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null && snippets.length < 4) {
      const text = match[1].replace(/<[^>]+>/g, '').trim();
      if (text) snippets.push(text);
    }

    if (snippets.length === 0) {
      return `Live Search Result for "${query}": No exact live search results found.`;
    }

    const summary = snippets.join('\n- ');
    console.log(`[Web Search Service] Found ${snippets.length} web snippets`);
    return `LIVE WEB SEARCH DATA FOR "${query}":\n- ${summary}`;
  } catch (error) {
    console.error('[Web Search Service] Error during search:', error.message);
    return `Live Web Search for "${query}" is currently unavailable.`;
  }
}

/**
 * Fetches content from a specific business website URL
 */
async function fetchPageContent(url) {
  try {
    if (!url || !url.startsWith('http')) return null;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      timeout: 5000
    });
    const cleanText = (response.data || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 1500);
    return cleanText;
  } catch (error) {
    console.error(`[Web Search Service] Error fetching URL ${url}:`, error.message);
    return null;
  }
}

module.exports = {
  searchWeb,
  fetchPageContent
};
