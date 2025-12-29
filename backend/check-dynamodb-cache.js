const { DynamoDBClient, ScanCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const crypto = require('crypto');

const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const tableName = 'lensy-processed-content-us-east-1';

function normalizeUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.hash = '';
        const params = new URLSearchParams(urlObj.search);
        const sortedParams = new URLSearchParams();
        Array.from(params.keys()).sort().forEach(key => {
            sortedParams.set(key, params.get(key) || '');
        });
        urlObj.search = sortedParams.toString();
        if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        urlObj.hostname = urlObj.hostname.toLowerCase();
        return urlObj.toString();
    } catch (error) {
        console.warn('Failed to normalize URL, using original:', url);
        return url;
    }
}

async function checkCacheEntries() {
    console.log('🔍 Checking DynamoDB Cache Entries');
    console.log('==================================');

    try {
        // First, scan the table to see what's in there
        const scanResponse = await dynamoClient.send(new ScanCommand({
            TableName: tableName,
            Limit: 10
        }));

        console.log(`\n📊 Found ${scanResponse.Items?.length || 0} cache entries:`);

        if (scanResponse.Items && scanResponse.Items.length > 0) {
            scanResponse.Items.forEach((item, index) => {
                const entry = unmarshall(item);
                console.log(`\n${index + 1}. Cache Entry:`);
                console.log('   URL:', entry.url);
                console.log('   Context:', entry.contextualSetting);
                console.log('   Processed At:', entry.processedAt);
                console.log('   S3 Location:', entry.s3Location);
                console.log('   TTL:', entry.ttl, '(expires:', new Date(entry.ttl * 1000).toISOString(), ')');
            });
        } else {
            console.log('❌ No cache entries found in DynamoDB table');
        }

        // Now test specific lookup for our test URL
        const testUrl = 'https://developer.wordpress.org/plugins/administration-menus/top-level-menus/';
        const cleanUrl = normalizeUrl(testUrl);

        console.log('\n🎯 Testing Specific Lookups:');
        console.log('Test URL:', testUrl);
        console.log('Normalized URL:', cleanUrl);

        // Test without context
        console.log('\n📝 Looking up WITHOUT context:');
        const withoutContextResponse = await dynamoClient.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
                url: cleanUrl,
                contextualSetting: 'without-context'
            })
        }));

        if (withoutContextResponse.Item) {
            const entry = unmarshall(withoutContextResponse.Item);
            console.log('✅ Found cache entry:');
            console.log('   Processed At:', entry.processedAt);
            console.log('   S3 Location:', entry.s3Location);
            console.log('   TTL:', entry.ttl, '(expires:', new Date(entry.ttl * 1000).toISOString(), ')');

            // Check if expired
            const now = Math.floor(Date.now() / 1000);
            const isExpired = entry.ttl < now;
            console.log('   Expired?', isExpired);
        } else {
            console.log('❌ No cache entry found for without-context');
        }

        // Test with context
        console.log('\n📝 Looking up WITH context:');
        const withContextResponse = await dynamoClient.send(new GetItemCommand({
            TableName: tableName,
            Key: marshall({
                url: cleanUrl,
                contextualSetting: 'with-context'
            })
        }));

        if (withContextResponse.Item) {
            const entry = unmarshall(withContextResponse.Item);
            console.log('✅ Found cache entry:');
            console.log('   Processed At:', entry.processedAt);
            console.log('   S3 Location:', entry.s3Location);
            console.log('   TTL:', entry.ttl, '(expires:', new Date(entry.ttl * 1000).toISOString(), ')');

            // Check if expired
            const now = Math.floor(Date.now() / 1000);
            const isExpired = entry.ttl < now;
            console.log('   Expired?', isExpired);
        } else {
            console.log('❌ No cache entry found for with-context');
        }

    } catch (error) {
        console.error('❌ Error checking cache:', error.message);
    }
}

checkCacheEntries();