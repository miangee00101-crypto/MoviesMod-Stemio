const express = require('express');
const cors = require('cors');
const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());

const MOVIESMOD_BASE = 'https://moviesmod.ai.in';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

const manifest = {
    id: 'org.moviesmod.stremio',
    version: '1.5.0',
    name: 'MoviesMod Streams',
    description: 'Scrapes direct playable video streams from MoviesMod',
    resources: ['stream'],
    types: ['movie'],
    idPrefixes: ['tt']
};

const builder = new addonBuilder(manifest);

async function getMovieInfo(imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.fun/meta/movie/${imdbId}.json`, { timeout: 3000 });
        if (res.data && res.data.meta) {
            return { name: res.data.meta.name, year: res.data.meta.year };
        }
    } catch (e) {
        console.error('Error fetching Cinemeta metadata:', e.message);
    }
    return null;
}

async function searchMoviesMod(query) {
    try {
        const searchUrl = `${MOVIESMOD_BASE}/?s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        
        let targetLink = null;
        $('article, .post-item, .latest-host-list, h2.entry-title').each((_, el) => {
            const link = $(el).find('a').attr('href') \vert{}\vert{}$(el).attr('href');
            if (link && !targetLink && link.includes('moviesmod')) {
                targetLink = link;
            }
        });
        return targetLink;
    } catch (e) {
        console.error('Search error:', e.message);
        return null;
    }
}

async function extractHubCloudLinks(postUrl) {
    try {
        const { data } = await axios.get(postUrl, { headers: HEADERS, timeout: 5000 });
        const $ = cheerio.load(data);
        const links = [];

        $('a[href*="hubcloud"], a[href*="drivehub"], a[href*="techmky"]').each((_, el) => {
            const url = $(el).attr('href');
            const parentText = $(el).closest('p, div, h3').text().trim();
            
            let quality = '720p';
            if (parentText.includes('1080p')) quality = '1080p';
            else if (parentText.includes('4K') || parentText.includes('2160p')) quality = '4K';
            else if (parentText.includes('480p')) quality = '480p';

            if (url) {
                links.push({ url, quality });
            }
        });

        return links;
    } catch (e) {
        console.error('Post extraction error:', e.message);
        return [];
    }
}

async function resolveStreamUrl(hubUrl) {
    try {
        const { data } = await axios.get(hubUrl, { headers: HEADERS, timeout: 4000 });
        const $ = cheerio.load(data);
        const directBtn = $('a[href*="download"], a.btn-primary, .download-btn').attr('href');
        return directBtn || hubUrl;
    } catch (e) {
        return hubUrl;
    }
}

builder.defineStreamHandler(async ({ id }) => {
    const movieInfo = await getMovieInfo(id);
    if (!movieInfo) return { streams: [] };

    const postUrl = await searchMoviesMod(movieInfo.name);
    if (!postUrl) return { streams: [] };

    const hubLinks = await extractHubCloudLinks(postUrl);
    if (!hubLinks.length) return { streams: [] };

    const streamPromises = hubLinks.slice(0, 3).map(async (item) => {
        const directUrl = await resolveStreamUrl(item.url);
        return {
            name: 'MoviesMod',
            title: `[${item.quality}] ${movieInfo.name}`,
            url: directUrl
        };
    });

    const streams = await Promise.all(streamPromises);
    return { streams };
});

const addonInterface = builder.getInterface();

// Handle root URL and config landing page
app.get('/', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const manifestUrl = `${protocol}://${host}/manifest.json`;
    const stremioUrl = `stremio://${host}/manifest.json`;

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MoviesMod Stremio Addon</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
            body { background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
            .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }
            h1 { font-size: 1.75rem; color: #38bdf8; margin-bottom: 8px; }
            p { color: #94a3b8; font-size: 0.95rem; margin-bottom: 24px; line-height: 1.5; }
            .badge { display: inline-block; background: #0284c7; color: #fff; font-size: 0.75rem; font-weight: 600; padding: 4px 10px; border-radius: 9999px; margin-bottom: 16px; text-transform: uppercase; }
            .actions { display: flex; flex-direction: column; gap: 12px; }
            .btn { display: flex; align-items: center; justify-content: center; padding: 12px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all 0.2s ease; border: none; font-size: 1rem; }
            .btn-primary { background: #8b5cf6; color: #ffffff; }
            .btn-primary:hover { background: #7c3aed; }
            .btn-secondary { background: #334155; color: #f8fafc; }
            .btn-secondary:hover { background: #475569; }
            .toast { margin-top: 16px; font-size: 0.85rem; color: #4ade80; display: none; }
        </style>
    </head>
    <body>
        <div class="card">
            <span class="badge">Stremio Addon</span>
            <h1>MoviesMod Streams</h1>
            <p>Scrape playable direct video stream links directly from MoviesMod inside Stremio.</p>
            <div class="actions">
                <a href="${stremioUrl}" class="btn btn-primary">Install to Stremio</a>
                <button onclick="copyManifest()" class="btn btn-secondary">Copy Manifest URL</button>
            </div>
            <div id="toast" class="toast">✓ Manifest URL copied to clipboard!</div>
        </div>
        <script>
            function copyManifest() {
                navigator.clipboard.writeText("${manifestUrl}").then(() => {
                    const toast = document.getElementById('toast');
                    toast.style.display = 'block';
                    setTimeout(() => { toast.style.display = 'none'; }, 3000);
                });
            }
        </script>
    </body>
    </html>
    `);
});

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get('/stream/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    const cleanId = id.replace('.json', '');
    const streamResults = await addonInterface.get('stream', type, cleanId);
    res.json(streamResults || { streams: [] });
});

module.exports = app;
