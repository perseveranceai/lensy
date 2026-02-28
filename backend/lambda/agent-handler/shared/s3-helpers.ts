import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const ANALYSIS_BUCKET = process.env.ANALYSIS_BUCKET || '';

/**
 * Write a JSON object to S3 under the session prefix.
 */
export async function writeSessionArtifact(
    sessionId: string,
    key: string,
    data: any,
    bucket?: string
): Promise<void> {
    const targetBucket = bucket || ANALYSIS_BUCKET;
    if (!targetBucket) {
        throw new Error('ANALYSIS_BUCKET not configured');
    }

    const s3Key = `sessions/${sessionId}/${key}`;
    console.log(`Writing artifact to s3://${targetBucket}/${s3Key}`);

    await s3Client.send(new PutObjectCommand({
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
export async function readSessionArtifact<T = any>(
    sessionId: string,
    key: string,
    bucket?: string
): Promise<T | null> {
    const targetBucket = bucket || ANALYSIS_BUCKET;
    if (!targetBucket) {
        throw new Error('ANALYSIS_BUCKET not configured');
    }

    const s3Key = `sessions/${sessionId}/${key}`;

    try {
        const result = await s3Client.send(new GetObjectCommand({
            Bucket: targetBucket,
            Key: s3Key
        }));

        const body = await result.Body?.transformToString();
        if (!body) return null;

        return JSON.parse(body) as T;
    } catch (error: any) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * Write raw data (not session-scoped) to S3.
 */
export async function writeToS3(
    bucket: string,
    key: string,
    data: any,
    contentType: string = 'application/json'
): Promise<void> {
    await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
        ContentType: contentType
    }));
}

/**
 * Read raw data from S3.
 */
export async function readFromS3<T = any>(
    bucket: string,
    key: string
): Promise<T | null> {
    try {
        const result = await s3Client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key
        }));

        const body = await result.Body?.transformToString();
        if (!body) return null;

        return JSON.parse(body) as T;
    } catch (error: any) {
        if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
            return null;
        }
        throw error;
    }
}

export { s3Client, ANALYSIS_BUCKET };
