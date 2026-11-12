// CloudFront Function (cloudfront-js-2.0), viewer request, for the Lensy website.
//
// scripts/prerender.js in frontend/ writes every route as <path>/index.html and
// every content page as <path>.md. This maps a request to those files:
//   /docs/cli                          -> /docs/cli/index.html
//   /docs/cli with Accept: text/markdown -> /docs/cli.md   (home: /index.md)
//   anything with a file extension     -> unchanged
// A path with no file behind it makes S3 answer 403, which the distribution turns
// into /404.html with status 404, so missing pages are real 404s.
//
// Moved pages answer with a permanent (301) same-host redirect, so old links,
// bookmarks and search results keep working. Never remove an entry: /bot is in
// the user agent of every request Lensy sends (scanner and published CLI
// versions), and /cli is in the README of published CLI versions.
// A trailing slash redirects to the address without it, so each page has one URL.
//
// frontend/scripts/serve-build.js runs this same file for local e2e runs, so the
// tests exercise the routing that gamma and prod use. Keep it plain ES5-style JS:
// CloudFront Functions don't support modules.
var MOVED = {
    '/cli': '/docs/cli',
    '/bot': '/docs/bot',
    '/how-it-works': '/docs/scores',
    '/education': '/learn',
    '/terms': '/legal/terms',
    '/privacy': '/legal/privacy',
    '/console': '/',
    '/console/lensy': '/'
};
// Whole folders that moved: /education/<slug> -> /learn/<slug>.
var MOVED_FOLDERS = [['/education/', '/learn/']];

function movedTo(path) {
    if (Object.prototype.hasOwnProperty.call(MOVED, path)) return MOVED[path];
    for (var i = 0; i < MOVED_FOLDERS.length; i++) {
        var from = MOVED_FOLDERS[i][0];
        if (path.indexOf(from) === 0 && path.length > from.length) return MOVED_FOLDERS[i][1] + path.substring(from.length);
    }
    return null;
}

function queryString(querystring) {
    if (!querystring) return '';
    var parts = [];
    for (var key in querystring) {
        if (!Object.prototype.hasOwnProperty.call(querystring, key)) continue;
        var item = querystring[key];
        var values = item.multiValue ? item.multiValue : [item];
        for (var j = 0; j < values.length; j++) {
            parts.push(values[j].value === '' ? key : key + '=' + values[j].value);
        }
    }
    return parts.length ? '?' + parts.join('&') : '';
}

function redirect(location, querystring) {
    return {
        statusCode: 301,
        statusDescription: 'Moved Permanently',
        headers: {
            location: { value: location + queryString(querystring) },
            'cache-control': { value: 'max-age=3600' }
        }
    };
}

function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Markdown copies of moved pages: /cli.md -> /docs/cli.md.
    if (/\.md$/.test(uri)) {
        var mdTarget = movedTo(uri.slice(0, -3));
        if (mdTarget) return redirect(mdTarget === '/' ? '/index.md' : mdTarget + '.md', request.querystring);
        return request;
    }

    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    if (lastSegment.indexOf('.') !== -1) return request;

    var base = uri.replace(/\/+$/, '');
    var target = movedTo(base);
    if (target) return redirect(target, request.querystring);
    if (base !== '' && base !== uri) return redirect(base, request.querystring);

    var accept = request.headers.accept ? request.headers.accept.value : '';
    if (accept.indexOf('text/markdown') !== -1) {
        request.uri = (base === '' ? '/index' : base) + '.md';
        return request;
    }
    request.uri = base + '/index.html';
    return request;
}
