function handler(event) {
    var request = event.request;
    var accept = request.headers.accept;
    if (accept && accept.value.indexOf('text/markdown') >= 0) {
        var uri = request.uri;
        if (uri.endsWith('/')) {
            uri = uri.slice(0, -1);
        }
        if (uri.endsWith('/index.html')) {
            uri = uri.slice(0, -11);
        }
        if (uri.length > 0) {
            request.uri = uri + '.md';
        }
    }
    return request;
}
