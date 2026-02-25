#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { LensyStack } from '../lib/lensy-stack';

const app = new cdk.App();

// Get environment configuration
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';
const lensyEnv = process.env.LENSY_ENV || 'prod';

// Stack name: 'LensyStack' for prod, 'LensyStack-gamma' for gamma, etc.
const stackName = lensyEnv === 'prod' ? 'LensyStack' : `LensyStack-${lensyEnv}`;

new LensyStack(app, stackName, {
    env: {
        account,
        region
    },
    lensyEnv,
    description: `Lensy Documentation Quality Auditor (${lensyEnv})`,
});