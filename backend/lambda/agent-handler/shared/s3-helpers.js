"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANALYSIS_BUCKET = exports.s3Client = void 0;
exports.writeSessionArtifact = writeSessionArtifact;
exports.readSessionArtifact = readSessionArtifact;
exports.writeToS3 = writeToS3;
exports.readFromS3 = readFromS3;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
exports.s3Client = s3Client;
const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';
exports.ANALYSIS_BUCKET = ANALYSIS_BUCKET;
/**
 * Write a JSON object to S3 under the session prefix.
 */
async function writeSessionArtifact(sessionId, key, data, bucket) {
    const targetBucket = bucket || ANALYSIS_BUCKET;
    if (!targetBucket) {
        throw new Error('ANALYSIS_BUCKET not configured');
    }
    const s3Key = `sessions/${sessionId}/${key}`;
    console.log(`Writing artifact to s3://${targetBucket}/${s3Key}`);
    await s3Client.send(new client_s3_1.PutObjectCommand({
        Bucket: targetBucket,
        Key: s3Key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json'
    }));
}
/**
 * Read a JSON object from S3 under the session prefix.
 * Returns null if the object doesn't exist.
 */
async function readSessionArtifact(sessionId, key, bucket) {
    const targetBucket = bucket || ANALYSIS_BUCKET;
    if (!targetBucket) {
        throw new Error('ANALYSIS_BUCKET not configured');
    }
    const s3Key = `sessions/${sessionId}/${key}`;
    try {
        const result = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: targetBucket,
            Key: s3Key
        }));
        const body = await result.Body?.transformToString();
        if (!body)
            return null;
        return JSON.parse(body);
    }
    catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
}
/**
 * Write raw data (not session-scoped) to S3.
 */
async function writeToS3(bucket, key, data, contentType = 'application/json') {
    await s3Client.send(new client_s3_1.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        ContentType: contentType
    }));
}
/**
 * Read raw data from S3.
 */
async function readFromS3(bucket, key) {
    try {
        const result = await s3Client.send(new client_s3_1.GetObjectCommand({
            Bucket: bucket,
            Key: key
        }));
        const body = await result.Body?.transformToString();
        if (!body)
            return null;
        return JSON.parse(body);
    }
    catch (error) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
}
