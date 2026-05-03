function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : '';
    var uri = request.uri;

    // Allow raw CloudFront domain through (brand-neutral mode for WTD)
    if (host.endsWith('.cloudfront.net')) {
        // SPA routing: serve index.html for non-file paths
        if (uri !== '/' && !uri.includes('.')) {
            request.uri = '/index.html';
        }
        return request;
    }

    // Redirect console.perseveranceai.com → perseveranceai.com
    var qsKeys = Object.keys(request.querystring);
    var qs = qsKeys.length > 0 ? ('?' + qsKeys.map(function (k) { return k + '=' + request.querystring[k].value; }).join('&')) : '';
    return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: {
            'location': { value: 'https://perseveranceai.com' + uri + qs },
            'cache-control': { value: 'max-age=86400' }
        }
    };
}
