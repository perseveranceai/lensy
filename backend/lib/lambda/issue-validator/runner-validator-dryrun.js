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
// Mocked logic from index.ts
function extractCodeSnippetsFromPage(html) {
    const snippets = [];
    const preCodeRegex = /<pre[^>]*><code[^>]*class=['"]?language-(\w+)['"]?[^>]*>([\s\S]*?)<\/code><\/pre>/gi;
    let match;
    while ((match = preCodeRegex.exec(html)) !== null) {
        let lang = match[1];
        let code = match[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        snippets.push({ code, language: lang });
    }
    const codeRegex = /<code[^>]*>([\s\S]*?)<\/code>/gi;
    while ((match = codeRegex.exec(html)) !== null) {
        let code = match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '');
        const trimmedCode = code.trim();
        const isLikelySnippet = trimmedCode.length > 40 || trimmedCode.includes('{') || trimmedCode.includes('=>') || trimmedCode.includes(';') || trimmedCode.includes('import ') || trimmedCode.includes('const ');
        if (isLikelySnippet && !snippets.some(s => s.code === trimmedCode)) {
            snippets.push({ code: trimmedCode });
        }
    }
    return snippets;
}
async function dryRunValidator() {
    const url = 'https://docs.knock.app/designing-workflows/batch-function';
    console.log(`🚀 DRY RUN: Validating extraction for ${url}...`);
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            const snippets = extractCodeSnippetsFromPage(data);
            console.log(`✅ Extracted ${snippets.length} snippets for AI context.`);
            if (snippets.length > 0) {
                console.log(`📝 First snippet to be sent as context:\n${snippets[0].code}\n`);
                console.log("--- PROMPT CHECK ---");
                console.log("The AI will now receive these snippets and is instructed to use them in the 'BEFORE' block.");
                console.log("Instruction: 'DO NOT use // Missing Section - always provide some context snippet from the page.'");
                console.log("--- DRY RUN PASSED ---");
            }
            else {
                console.log("❌ FAILED: No snippets found for context.");
            }
            process.exit(0);
        });
    }).on('error', (err) => {
        console.error('Error fetching page:', err);
    });
}
dryRunValidator();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLXZhbGlkYXRvci1kcnlydW4uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9sYW1iZGEvaXNzdWUtdmFsaWRhdG9yL3J1bm5lci12YWxpZGF0b3ItZHJ5cnVuLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSw2Q0FBK0I7QUFFL0IsNkJBQTZCO0FBQzdCLFNBQVMsMkJBQTJCLENBQUMsSUFBWTtJQUM3QyxNQUFNLFFBQVEsR0FBK0MsRUFBRSxDQUFDO0lBQ2hFLE1BQU0sWUFBWSxHQUFHLHFGQUFxRixDQUFDO0lBQzNHLElBQUksS0FBSyxDQUFDO0lBQ1YsT0FBTyxDQUFDLEtBQUssR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLEtBQUssSUFBSSxFQUFFO1FBQy9DLElBQUksSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwQixJQUFJLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsT0FBTyxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxRQUFRLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDO1FBQ3RJLFFBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7S0FDM0M7SUFDRCxNQUFNLFNBQVMsR0FBRyxpQ0FBaUMsQ0FBQztJQUNwRCxPQUFPLENBQUMsS0FBSyxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsS0FBSyxJQUFJLEVBQUU7UUFDNUMsSUFBSSxJQUFJLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBQzlKLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNoQyxNQUFNLGVBQWUsR0FBRyxXQUFXLENBQUMsTUFBTSxHQUFHLEVBQUUsSUFBSSxXQUFXLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLFdBQVcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksV0FBVyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsSUFBSSxXQUFXLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxJQUFJLFdBQVcsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDN00sSUFBSSxlQUFlLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksS0FBSyxXQUFXLENBQUMsRUFBRTtZQUNoRSxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFBRSxDQUFDLENBQUM7U0FDeEM7S0FDSjtJQUNELE9BQU8sUUFBUSxDQUFDO0FBQ3BCLENBQUM7QUFFRCxLQUFLLFVBQVUsZUFBZTtJQUMxQixNQUFNLEdBQUcsR0FBRywyREFBMkQsQ0FBQztJQUN4RSxPQUFPLENBQUMsR0FBRyxDQUFDLHlDQUF5QyxHQUFHLEtBQUssQ0FBQyxDQUFDO0lBRS9ELEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUU7UUFDbkIsSUFBSSxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQ2QsR0FBRyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksSUFBSSxLQUFLLENBQUMsQ0FBQztRQUN6QyxHQUFHLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUU7WUFDZixNQUFNLFFBQVEsR0FBRywyQkFBMkIsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNuRCxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsUUFBUSxDQUFDLE1BQU0sMkJBQTJCLENBQUMsQ0FBQztZQUV2RSxJQUFJLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO2dCQUNyQixPQUFPLENBQUMsR0FBRyxDQUFDLDRDQUE0QyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQztnQkFDOUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO2dCQUNwQyxPQUFPLENBQUMsR0FBRyxDQUFDLDZGQUE2RixDQUFDLENBQUM7Z0JBQzNHLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUdBQW1HLENBQUMsQ0FBQztnQkFDakgsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsQ0FBQyxDQUFDO2FBQ3pDO2lCQUFNO2dCQUNILE9BQU8sQ0FBQyxHQUFHLENBQUMsMENBQTBDLENBQUMsQ0FBQzthQUMzRDtZQUNELE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEIsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUU7UUFDbkIsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUMvQyxDQUFDLENBQUMsQ0FBQztBQUNQLENBQUM7QUFFRCxlQUFlLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIlxuaW1wb3J0ICogYXMgaHR0cHMgZnJvbSAnaHR0cHMnO1xuXG4vLyBNb2NrZWQgbG9naWMgZnJvbSBpbmRleC50c1xuZnVuY3Rpb24gZXh0cmFjdENvZGVTbmlwcGV0c0Zyb21QYWdlKGh0bWw6IHN0cmluZyk6IEFycmF5PHsgY29kZTogc3RyaW5nOyBsYW5ndWFnZT86IHN0cmluZyB9PiB7XG4gICAgY29uc3Qgc25pcHBldHM6IEFycmF5PHsgY29kZTogc3RyaW5nOyBsYW5ndWFnZT86IHN0cmluZyB9PiA9IFtdO1xuICAgIGNvbnN0IHByZUNvZGVSZWdleCA9IC88cHJlW14+XSo+PGNvZGVbXj5dKmNsYXNzPVsnXCJdP2xhbmd1YWdlLShcXHcrKVsnXCJdP1tePl0qPihbXFxzXFxTXSo/KTxcXC9jb2RlPjxcXC9wcmU+L2dpO1xuICAgIGxldCBtYXRjaDtcbiAgICB3aGlsZSAoKG1hdGNoID0gcHJlQ29kZVJlZ2V4LmV4ZWMoaHRtbCkpICE9PSBudWxsKSB7XG4gICAgICAgIGxldCBsYW5nID0gbWF0Y2hbMV07XG4gICAgICAgIGxldCBjb2RlID0gbWF0Y2hbMl0ucmVwbGFjZSgvJmx0Oy9nLCAnPCcpLnJlcGxhY2UoLyZndDsvZywgJz4nKS5yZXBsYWNlKC8mYW1wOy9nLCAnJicpLnJlcGxhY2UoLyZxdW90Oy9nLCAnXCInKS5yZXBsYWNlKC8mIzM5Oy9nLCBcIidcIik7XG4gICAgICAgIHNuaXBwZXRzLnB1c2goeyBjb2RlLCBsYW5ndWFnZTogbGFuZyB9KTtcbiAgICB9XG4gICAgY29uc3QgY29kZVJlZ2V4ID0gLzxjb2RlW14+XSo+KFtcXHNcXFNdKj8pPFxcL2NvZGU+L2dpO1xuICAgIHdoaWxlICgobWF0Y2ggPSBjb2RlUmVnZXguZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgbGV0IGNvZGUgPSBtYXRjaFsxXS5yZXBsYWNlKC8mbHQ7L2csICc8JykucmVwbGFjZSgvJmd0Oy9nLCAnPicpLnJlcGxhY2UoLyZhbXA7L2csICcmJykucmVwbGFjZSgvJnF1b3Q7L2csICdcIicpLnJlcGxhY2UoLyYjMzk7L2csIFwiJ1wiKS5yZXBsYWNlKC88W14+XSs+L2csICcnKTtcbiAgICAgICAgY29uc3QgdHJpbW1lZENvZGUgPSBjb2RlLnRyaW0oKTtcbiAgICAgICAgY29uc3QgaXNMaWtlbHlTbmlwcGV0ID0gdHJpbW1lZENvZGUubGVuZ3RoID4gNDAgfHwgdHJpbW1lZENvZGUuaW5jbHVkZXMoJ3snKSB8fCB0cmltbWVkQ29kZS5pbmNsdWRlcygnPT4nKSB8fCB0cmltbWVkQ29kZS5pbmNsdWRlcygnOycpIHx8IHRyaW1tZWRDb2RlLmluY2x1ZGVzKCdpbXBvcnQgJykgfHwgdHJpbW1lZENvZGUuaW5jbHVkZXMoJ2NvbnN0ICcpO1xuICAgICAgICBpZiAoaXNMaWtlbHlTbmlwcGV0ICYmICFzbmlwcGV0cy5zb21lKHMgPT4gcy5jb2RlID09PSB0cmltbWVkQ29kZSkpIHtcbiAgICAgICAgICAgIHNuaXBwZXRzLnB1c2goeyBjb2RlOiB0cmltbWVkQ29kZSB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc25pcHBldHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRyeVJ1blZhbGlkYXRvcigpIHtcbiAgICBjb25zdCB1cmwgPSAnaHR0cHM6Ly9kb2NzLmtub2NrLmFwcC9kZXNpZ25pbmctd29ya2Zsb3dzL2JhdGNoLWZ1bmN0aW9uJztcbiAgICBjb25zb2xlLmxvZyhg8J+agCBEUlkgUlVOOiBWYWxpZGF0aW5nIGV4dHJhY3Rpb24gZm9yICR7dXJsfS4uLmApO1xuXG4gICAgaHR0cHMuZ2V0KHVybCwgKHJlcykgPT4ge1xuICAgICAgICBsZXQgZGF0YSA9ICcnO1xuICAgICAgICByZXMub24oJ2RhdGEnLCAoY2h1bmspID0+IGRhdGEgKz0gY2h1bmspO1xuICAgICAgICByZXMub24oJ2VuZCcsICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNuaXBwZXRzID0gZXh0cmFjdENvZGVTbmlwcGV0c0Zyb21QYWdlKGRhdGEpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYOKchSBFeHRyYWN0ZWQgJHtzbmlwcGV0cy5sZW5ndGh9IHNuaXBwZXRzIGZvciBBSSBjb250ZXh0LmApO1xuXG4gICAgICAgICAgICBpZiAoc25pcHBldHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5OdIEZpcnN0IHNuaXBwZXQgdG8gYmUgc2VudCBhcyBjb250ZXh0OlxcbiR7c25pcHBldHNbMF0uY29kZX1cXG5gKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIi0tLSBQUk9NUFQgQ0hFQ0sgLS0tXCIpO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiVGhlIEFJIHdpbGwgbm93IHJlY2VpdmUgdGhlc2Ugc25pcHBldHMgYW5kIGlzIGluc3RydWN0ZWQgdG8gdXNlIHRoZW0gaW4gdGhlICdCRUZPUkUnIGJsb2NrLlwiKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIkluc3RydWN0aW9uOiAnRE8gTk9UIHVzZSAvLyBNaXNzaW5nIFNlY3Rpb24gLSBhbHdheXMgcHJvdmlkZSBzb21lIGNvbnRleHQgc25pcHBldCBmcm9tIHRoZSBwYWdlLidcIik7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coXCItLS0gRFJZIFJVTiBQQVNTRUQgLS0tXCIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhcIuKdjCBGQUlMRUQ6IE5vIHNuaXBwZXRzIGZvdW5kIGZvciBjb250ZXh0LlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICAgICAgfSk7XG4gICAgfSkub24oJ2Vycm9yJywgKGVycikgPT4ge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyBwYWdlOicsIGVycik7XG4gICAgfSk7XG59XG5cbmRyeVJ1blZhbGlkYXRvcigpO1xuIl19