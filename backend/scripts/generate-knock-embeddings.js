"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
exports.__esModule = true;
var client_s3_1 = require("@aws-sdk/client-s3");
var client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
var https_1 = __importDefault(require("https"));
var s3Client = new client_s3_1.S3Client({ region: 'us-east-1' });
var bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({ region: 'us-east-1' });
/**
 * Make HTTPS request
 */
function makeHttpRequest(url) {
    return new Promise(function (resolve, reject) {
        https_1["default"].get(url, function (res) {
            var data = '';
            res.on('data', function (chunk) { return data += chunk; });
            res.on('end', function () { return resolve(data); });
        }).on('error', reject);
    });
}
/**
 * Generate embedding for text using Amazon Bedrock Titan
 */
function generateEmbedding(text) {
    return __awaiter(this, void 0, void 0, function () {
        var input, command, response, responseBody, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    input = {
                        modelId: 'amazon.titan-embed-text-v1',
                        contentType: 'application/json',
                        accept: 'application/json',
                        body: JSON.stringify({
                            inputText: text
                        })
                    };
                    command = new client_bedrock_runtime_1.InvokeModelCommand(input);
                    return [4 /*yield*/, bedrockClient.send(command)];
                case 1:
                    response = _a.sent();
                    responseBody = JSON.parse(new TextDecoder().decode(response.body));
                    return [2 /*return*/, responseBody.embedding];
                case 2:
                    error_1 = _a.sent();
                    console.error('Error generating embedding:', error_1);
                    throw error_1;
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Extract page content from HTML
 */
function extractPageContent(html) {
    // Extract title
    var titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    var title = titleMatch ? titleMatch[1].trim() : '';
    // Extract meta description
    var descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*?)["'][^>]*>/i);
    var description = descMatch ? descMatch[1].trim() : '';
    // Extract main content (remove scripts, styles, nav, footer)
    var content = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // Limit content length for embedding
    if (content.length > 8000) {
        content = content.substring(0, 8000) + '...';
    }
    return { title: title, description: description, content: content };
}
/**
 * Fetch sitemap and extract URLs
 */
function fetchSitemap() {
    return __awaiter(this, void 0, void 0, function () {
        var sitemapUrl, xml, urlMatches, urls;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    sitemapUrl = 'https://docs.knock.app/sitemap.xml';
                    console.log("Fetching sitemap from: ".concat(sitemapUrl));
                    return [4 /*yield*/, makeHttpRequest(sitemapUrl)];
                case 1:
                    xml = _a.sent();
                    urlMatches = xml.match(/<loc>(.*?)<\/loc>/g) || [];
                    urls = urlMatches.map(function (match) {
                        var url = match.replace(/<\/?loc>/g, '');
                        return url;
                    });
                    console.log("Found ".concat(urls.length, " URLs in sitemap"));
                    return [2 /*return*/, urls];
            }
        });
    });
}
/**
 * Fetch page content
 */
function fetchPageContent(url) {
    return __awaiter(this, void 0, void 0, function () {
        var error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, makeHttpRequest(url)];
                case 1: return [2 /*return*/, _a.sent()];
                case 2:
                    error_2 = _a.sent();
                    console.error("Failed to fetch ".concat(url, ":"), error_2);
                    return [2 /*return*/, null];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * Main function to generate embeddings
 */
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var startTime, urls, embeddings, i, url, progress, html, _a, title, description, content, textForEmbedding, embedding, urlObj, pathname, error_3, bucketName, embeddingsKey, putCommand, elapsedTime, error_4;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    console.log('🚀 Starting Knock.app documentation embedding generation...\n');
                    startTime = Date.now();
                    return [4 /*yield*/, fetchSitemap()];
                case 1:
                    urls = _b.sent();
                    embeddings = [];
                    console.log("\n\uD83D\uDCC4 Processing ".concat(urls.length, " pages...\n"));
                    i = 0;
                    _b.label = 2;
                case 2:
                    if (!(i < urls.length)) return [3 /*break*/, 9];
                    url = urls[i];
                    progress = "[".concat(i + 1, "/").concat(urls.length, "]");
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 7, , 8]);
                    return [4 /*yield*/, fetchPageContent(url)];
                case 4:
                    html = _b.sent();
                    if (!html) {
                        console.log("".concat(progress, " \u23ED\uFE0F  Skipped: ").concat(url, " (fetch failed)"));
                        return [3 /*break*/, 8];
                    }
                    _a = extractPageContent(html), title = _a.title, description = _a.description, content = _a.content;
                    textForEmbedding = "".concat(title, " ").concat(description, " ").concat(content).trim();
                    if (textForEmbedding.length < 10) {
                        console.log("".concat(progress, " \u23ED\uFE0F  Skipped: ").concat(url, " (minimal content)"));
                        return [3 /*break*/, 8];
                    }
                    return [4 /*yield*/, generateEmbedding(textForEmbedding)];
                case 5:
                    embedding = _b.sent();
                    urlObj = new URL(url);
                    pathname = urlObj.pathname;
                    embeddings.push({
                        url: pathname,
                        title: title,
                        description: description,
                        content: content,
                        embedding: embedding
                    });
                    console.log("".concat(progress, " \u2705 Generated: ").concat(pathname, " (").concat(title.substring(0, 50), "...)"));
                    // Add small delay to avoid rate limiting
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 100); })];
                case 6:
                    // Add small delay to avoid rate limiting
                    _b.sent();
                    return [3 /*break*/, 8];
                case 7:
                    error_3 = _b.sent();
                    console.error("".concat(progress, " \u274C Failed: ").concat(url), error_3);
                    return [3 /*break*/, 8];
                case 8:
                    i++;
                    return [3 /*break*/, 2];
                case 9:
                    console.log("\n\uD83D\uDCCA Generated ".concat(embeddings.length, " embeddings\n"));
                    bucketName = 'lensy-analysis-951411676525-us-east-1';
                    embeddingsKey = 'rich-content-embeddings-docs-knock-app.json';
                    _b.label = 10;
                case 10:
                    _b.trys.push([10, 12, , 13]);
                    putCommand = new client_s3_1.PutObjectCommand({
                        Bucket: bucketName,
                        Key: embeddingsKey,
                        Body: JSON.stringify(embeddings, null, 2),
                        ContentType: 'application/json'
                    });
                    return [4 /*yield*/, s3Client.send(putCommand)];
                case 11:
                    _b.sent();
                    elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                    console.log("\u2705 Stored embeddings in S3: s3://".concat(bucketName, "/").concat(embeddingsKey));
                    console.log("\u23F1\uFE0F  Total time: ".concat(elapsedTime, "s"));
                    console.log("\uD83D\uDCE6 File size: ".concat((JSON.stringify(embeddings).length / 1024 / 1024).toFixed(2), " MB"));
                    return [3 /*break*/, 13];
                case 12:
                    error_4 = _b.sent();
                    console.error('❌ Failed to store embeddings in S3:', error_4);
                    throw error_4;
                case 13: return [2 /*return*/];
            }
        });
    });
}
main()["catch"](console.error);
