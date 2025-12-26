#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LensyStack } from '../lib/lensy-stack';

const app = new cdk.App();

// Get environment configuration
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';

new LensyStack(app, 'LensyStack', {
    env: {
        account,
        region
    },
    description: 'Lensy Documentation Quality Auditor - AI-powered documentation analysis with real-time transparency'
});