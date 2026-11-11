// CloudFront Function (cloudfront-js-2.0), viewer request, for the Lensy website.
//
// scripts/prerender.js in frontend/ writes every route as <path>/index.html and
// every content page as <path>.md. This maps a request to those files:
//   /cli                          -> /cli/index.html
//   /cli with Accept: text/markdown -> /cli.md   (home: /index.md)
//   anything with a file extension -> unchanged
// A path with no file behind it makes S3 answer 403, which the distribution turns
// into /404.html with status 404, so missing pages are real 404s.
//
// frontend/scripts/serve-build.js runs this same file for local e2e runs, so the
// tests exercise the routing that gamma and prod use. Keep it plain ES5-style JS:
// CloudFront Functions don't support modules.
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    if (lastSegment.indexOf('.') !== -1) return request;

    var base = uri.replace(/\/+$/, '');
    var accept = request.headers.accept ? request.headers.accept.value : '';
    if (accept.indexOf('text/markdown') !== -1) {
        request.uri = (base === '' ? '/index' : base) + '.md';
        return request;
    }
    request.uri = base + '/index.html';
    return request;
}
