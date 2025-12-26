// Quick test of the URL processor Lambda function
const { handler } = require('./backend/lambda/url-processor/index.ts');

async function testURLProcessor() {
    console.log('Testing URL Processor...');

    const testEvent = {
        url: 'https://developer.wordpress.org/block-editor/',
        selectedModel: 'auto',
        sessionId: 'test-session-123'
    };

    try {
        const result = await handler(testEvent);
        console.log('✅ URL Processor test completed');
        console.log('Success:', result.success);
        if (result.success) {
            console.log('Content type:', result.processedContent.contentType);
            console.log('Code snippets found:', result.processedContent.codeSnippets.length);
            console.log('Media elements found:', result.processedContent.mediaElements.length);
            console.log('Links analyzed:', result.linkAnalysis.totalLinks);
            console.log('Sub-pages identified:', result.linkAnalysis.subPagesIdentified.length);
        } else {
            console.log('Error:', result.error);
        }
    } catch (error) {
        console.error('❌ URL Processor test failed:', error.message);
    }
}

// Run the test
testURLProcessor();