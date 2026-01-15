"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const https = __importStar(require("https"));
function extractCodeSnippetsFromPage(html) {
    const snippets = [];
    // Match <pre><code> blocks
    const preCodeRegex = /<pre[^>]*><code[^>]*class=['"]?language-(\w+)['"]?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
    let match;
    while ((match = preCodeRegex.exec(html)) !== null) {
        let lang = match[1];
        let code = match[2]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"');
        snippets.push({ code, language: lang });
    }
    // 2. Comprehensive: Match any <code> blocks that look like code (long or contains symbols)
    const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
    while ((match = codeRegex.exec(html)) !== null) {
        let code = match[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/<[^>]+>/g, ''); // Remove any nested tags
        const trimmedCode = code.trim();
        // Logic to distinguish real code snippets from small inline words
        const isLikelySnippet = trimmedCode.length > 40 ||
            trimmedCode.includes('{') ||
            trimmedCode.includes('=>') ||
            trimmedCode.includes(';') ||
            trimmedCode.includes('import ') ||
            trimmedCode.includes('const ');
        if (isLikelySnippet) {
            // Avoid duplicates with pre/code blocks
            if (!snippets.some(s => s.code === trimmedCode)) {
                snippets.push({ code: trimmedCode });
            }
        }
    }
    return snippets;
}
async function testExtraction() {
    // Try the batch function page
    const url = 'https://docs.knock.app/designing-workflows/batch-function';
    console.log(`Fetching ${url}...`);
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log(`Fetched ${data.length} bytes.`);
            // DEBUG: Show first two <pre> tags
            const preTags = data.match(/<pre[\s\S]*?<\/pre>/gi);
            if (preTags) {
                console.log(`Found ${preTags.length} <pre> tags.`);
                preTags.slice(0, 2).forEach((tag, i) => {
                    console.log(`--- RAW PRE TAG ${i + 1} ---`);
                    console.log(tag.substring(0, 300));
                });
            }
            else {
                console.log("No <pre> tags found at all!");
                const nextDataIndex = data.indexOf('__NEXT_DATA__');
                if (nextDataIndex !== -1) {
                    console.log(`Found __NEXT_DATA__ at index ${nextDataIndex}. Context:`);
                    console.log(data.substring(nextDataIndex, nextDataIndex + 1000));
                }
                else {
                    console.log("__NEXT_DATA__ not found.");
                }
            }
            const snippets = extractCodeSnippetsFromPage(data);
            console.log(`Extracted ${snippets.length} snippets.`);
            snippets.forEach((s, i) => {
                console.log(`--- Snippet ${i + 1} (${s.language || 'unknown'}) ---`);
                console.log(s.code.substring(0, 100) + (s.code.length > 100 ? '...' : ''));
            });
            process.exit(0);
        });
    }).on('error', (err) => {
        console.error('Error fetching page:', err);
    });
}
testExtraction();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLWV4dHJhY3Rpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvaXNzdWUtdmFsaWRhdG9yL3J1bm5lci1leHRyYWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw2Q0FBK0I7QUFFL0IsU0FBUywyQkFBMkIsQ0FBQyxJQUFZO0lBQzdDLE1BQU0sUUFBUSxHQUErQyxFQUFFLENBQUM7SUFFaEUsMkJBQTJCO0lBQzNCLE1BQU0sWUFBWSxHQUFHLHFGQUFxRixDQUFDO0lBQzNHLElBQUksS0FBSyxDQUFDO0lBRVYsT0FBTyxDQUFDLEtBQUssR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQy9DLElBQUksSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwQixJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDO2FBQ2QsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUM7YUFDckIsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUM7YUFDckIsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUM7YUFDdEIsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUM7YUFDdEIsT0FBTyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztRQUM3QixRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0tBQzNDO0lBRUQsMkZBQTJGO0lBQzNGLE1BQU0sU0FBUyxHQUFHLGlDQUFpQyxDQUFDO0lBQ3BELE9BQU8sQ0FBQyxLQUFLLEdBQUcsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLElBQUksRUFBRTtRQUM1QyxJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDO2FB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LENBQUMsYUFBYSxFQUFFLGFBQWEsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDO2lCQUNwRTtxQkFBTTtvQkFDSCxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixDQUFDLENBQUM7aUJBQzNDO2FBQ0o7WUFFRCxNQUFNLFFBQVEsR0FBRywyQkFBMkIsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNuRCxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsUUFBUSxDQUFDLE1BQU0sWUFBWSxDQUFDLENBQUM7WUFDdEQsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtnQkFDdEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsSUFBSSxTQUFTLE9BQU8sQ0FBQyxDQUFDO2dCQUNyRSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1lBQy9FLENBQUMsQ0FBQyxDQUFDO1lBQ0gsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwQixDQUFDLENBQUMsQ0FBQztJQUNQLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtRQUNuQixPQUFPLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQy9DLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELGNBQWMsRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiXG5pbXBvcnQgKiBhcyBodHRwcyBmcm9tICdodHRwcyc7XG5cbmZ1bmN0aW9uIGV4dHJhY3RDb2RlU25pcHBldHNGcm9tUGFnZShodG1sOiBzdHJpbmcpOiBBcnJheTx7IGNvZGU6IHN0cmluZzsgbGFuZ3VhZ2U/OiBzdHJpbmcgfT4ge1xuICAgIGNvbnN0IHNuaXBwZXRzOiBBcnJheTx7IGNvZGU6IHN0cmluZzsgbGFuZ3VhZ2U/OiBzdHJpbmcgfT4gPSBbXTtcblxuICAgIC8vIE1hdGNoIDxwcmU+PGNvZGU+IGJsb2Nrc1xuICAgIGNvbnN0IHByZUNvZGVSZWdleCA9IC88cHJlW14+XSo+PGNvZGVbXj5dKmNsYXNzPVsnXCJdP2xhbmd1YWdlLShcXHcrKVsnXCJdP1tePl0qPihbXFxzXFxTXSo/KTxcXC9jb2RlPjxcXC9wcmU+L2dpO1xuICAgIGxldCBtYXRjaDtcblxuICAgIHdoaWxlICgobWF0Y2ggPSBwcmVDb2RlUmVnZXguZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgbGV0IGxhbmcgPSBtYXRjaFsxXTtcbiAgICAgICAgbGV0IGNvZGUgPSBtYXRjaFsyXVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZsdDsvZywgJzwnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZndDsvZywgJz4nKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZhbXA7L2csICcmJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mIzM5Oy9nLCBcIidcIilcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mcXVvdDsvZywgJ1wiJyk7XG4gICAgICAgIHNuaXBwZXRzLnB1c2goeyBjb2RlLCBsYW5ndWFnZTogbGFuZyB9KTtcbiAgICB9XG5cbiAgICAvLyAyLiBDb21wcmVoZW5zaXZlOiBNYXRjaCBhbnkgPGNvZGU+IGJsb2NrcyB0aGF0IGxvb2sgbGlrZSBjb2RlIChsb25nIG9yIGNvbnRhaW5zIHN5bWJvbHMpXG4gICAgY29uc3QgY29kZVJlZ2V4ID0gLzxjb2RlW14+XSo+KFtcXHNcXFNdKj8pPFxcL2NvZGU+L2dpO1xuICAgIHdoaWxlICgobWF0Y2ggPSBjb2RlUmVnZXguZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgbGV0IGNvZGUgPSBtYXRjaFsxXVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZsdDsvZywgJzwnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZndDsvZywgJz4nKVxuICAgICAgICAgICAgLnJlcGxhY2UoLyZhbXA7L2csICcmJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mcXVvdDsvZywgJ1wiJylcbiAgICAgICAgICAgIC5yZXBsYWNlKC8mIzM5Oy9nLCBcIidcIilcbiAgICAgICAgICAgIC5yZXBsYWNlKC88W14+XSs+L2csICcnKTsgLy8gUmVtb3ZlIGFueSBuZXN0ZWQgdGFnc1xuXG4gICAgICAgIGNvbnN0IHRyaW1tZWRDb2RlID0gY29kZS50cmltKCk7XG5cbiAgICAgICAgLy8gTG9naWMgdG8gZGlzdGluZ3Vpc2ggcmVhbCBjb2RlIHNuaXBwZXRzIGZyb20gc21hbGwgaW5saW5lIHdvcmRzXG4gICAgICAgIGNvbnN0IGlzTGlrZWx5U25pcHBldCA9IHRyaW1tZWRDb2RlLmxlbmd0aCA+IDQwIHx8XG4gICAgICAgICAgICB0cmltbWVkQ29kZS5pbmNsdWRlcygneycpIHx8XG4gICAgICAgICAgICB0cmltbWVkQ29kZS5pbmNsdWRlcygnPT4nKSB8fFxuICAgICAgICAgICAgdHJpbW1lZENvZGUuaW5jbHVkZXMoJzsnKSB8fFxuICAgICAgICAgICAgdHJpbW1lZENvZGUuaW5jbHVkZXMoJ2ltcG9ydCAnKSB8fFxuICAgICAgICAgICAgdHJpbW1lZENvZGUuaW5jbHVkZXMoJ2NvbnN0ICcpO1xuXG4gICAgICAgIGlmIChpc0xpa2VseVNuaXBwZXQpIHtcbiAgICAgICAgICAgIC8vIEF2b2lkIGR1cGxpY2F0ZXMgd2l0aCBwcmUvY29kZSBibG9ja3NcbiAgICAgICAgICAgIGlmICghc25pcHBldHMuc29tZShzID0+IHMuY29kZSA9PT0gdHJpbW1lZENvZGUpKSB7XG4gICAgICAgICAgICAgICAgc25pcHBldHMucHVzaCh7IGNvZGU6IHRyaW1tZWRDb2RlIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNuaXBwZXRzO1xufVxuXG5hc3luYyBmdW5jdGlvbiB0ZXN0RXh0cmFjdGlvbigpIHtcbiAgICAvLyBUcnkgdGhlIGJhdGNoIGZ1bmN0aW9uIHBhZ2VcbiAgICBjb25zdCB1cmwgPSAnaHR0cHM6Ly9kb2NzLmtub2NrLmFwcC9kZXNpZ25pbmctd29ya2Zsb3dzL2JhdGNoLWZ1bmN0aW9uJztcbiAgICBjb25zb2xlLmxvZyhgRmV0Y2hpbmcgJHt1cmx9Li4uYCk7XG5cbiAgICBodHRwcy5nZXQodXJsLCAocmVzKSA9PiB7XG4gICAgICAgIGxldCBkYXRhID0gJyc7XG4gICAgICAgIHJlcy5vbignZGF0YScsIChjaHVuaykgPT4gZGF0YSArPSBjaHVuayk7XG4gICAgICAgIHJlcy5vbignZW5kJywgKCkgPT4ge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEZldGNoZWQgJHtkYXRhLmxlbmd0aH0gYnl0ZXMuYCk7XG5cbiAgICAgICAgICAgIC8vIERFQlVHOiBTaG93IGZpcnN0IHR3byA8cHJlPiB0YWdzXG4gICAgICAgICAgICBjb25zdCBwcmVUYWdzID0gZGF0YS5tYXRjaCgvPHByZVtcXHNcXFNdKj88XFwvcHJlPi9naSk7XG4gICAgICAgICAgICBpZiAocHJlVGFncykge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3ByZVRhZ3MubGVuZ3RofSA8cHJlPiB0YWdzLmApO1xuICAgICAgICAgICAgICAgIHByZVRhZ3Muc2xpY2UoMCwgMikuZm9yRWFjaCgodGFnLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGAtLS0gUkFXIFBSRSBUQUcgJHtpICsgMX0gLS0tYCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKHRhZy5zdWJzdHJpbmcoMCwgMzAwKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiTm8gPHByZT4gdGFncyBmb3VuZCBhdCBhbGwhXCIpO1xuICAgICAgICAgICAgICAgIGNvbnN0IG5leHREYXRhSW5kZXggPSBkYXRhLmluZGV4T2YoJ19fTkVYVF9EQVRBX18nKTtcbiAgICAgICAgICAgICAgICBpZiAobmV4dERhdGFJbmRleCAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIF9fTkVYVF9EQVRBX18gYXQgaW5kZXggJHtuZXh0RGF0YUluZGV4fS4gQ29udGV4dDpgKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coZGF0YS5zdWJzdHJpbmcobmV4dERhdGFJbmRleCwgbmV4dERhdGFJbmRleCArIDEwMDApKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIl9fTkVYVF9EQVRBX18gbm90IGZvdW5kLlwiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGNvbnN0IHNuaXBwZXRzID0gZXh0cmFjdENvZGVTbmlwcGV0c0Zyb21QYWdlKGRhdGEpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYEV4dHJhY3RlZCAke3NuaXBwZXRzLmxlbmd0aH0gc25pcHBldHMuYCk7XG4gICAgICAgICAgICBzbmlwcGV0cy5mb3JFYWNoKChzLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYC0tLSBTbmlwcGV0ICR7aSArIDF9ICgke3MubGFuZ3VhZ2UgfHwgJ3Vua25vd24nfSkgLS0tYCk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2cocy5jb2RlLnN1YnN0cmluZygwLCAxMDApICsgKHMuY29kZS5sZW5ndGggPiAxMDAgPyAnLi4uJyA6ICcnKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICAgICAgfSk7XG4gICAgfSkub24oJ2Vycm9yJywgKGVycikgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyBwYWdlOicsIGVycik7XG4gICAgfSk7XG59XG5cbnRlc3RFeHRyYWN0aW9uKCk7XG4iXX0=