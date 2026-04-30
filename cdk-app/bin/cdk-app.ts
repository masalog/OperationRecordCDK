#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { NetworkStack } from '../lib/network-stack';
import { EcsStack } from '../lib/ecs-stack';
import { RdsStack } from '../lib/rds-stack';

const app = new cdk.App();

// 環境設定（全スタック共通）
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
};

/* =========================
 * CDK Context の取得
 * ========================= */

// ECS / ECR 用
const ecrRepositoryName = app.node.tryGetContext('ecrRepositoryName') as string;
const ecrImageTag = (app.node.tryGetContext('ecrImageTag') as string) ?? 'latest';

// ECS が読む S3 env 用
const envBucketName = app.node.tryGetContext('envBucketName') as string;
const envObjectKey = app.node.tryGetContext('envObjectKey') as string;

// ★追加：既存SQS（例: line-webhook-events）
const targetQueueArn = app.node.tryGetContext('targetQueueArn') as string;
const targetQueueUrl = app.node.tryGetContext('targetQueueUrl') as string;

// RDS 用（Context 認証）
const dbUsername = app.node.tryGetContext('dbUsername') as string;
const dbPassword = app.node.tryGetContext('dbPassword') as string;
const dbName = (app.node.tryGetContext('dbName') as string) ?? 'appdb';

/* =========================
 * Context のバリデーション
 * ========================= */

if (!ecrRepositoryName) {
  throw new Error("CDK Context 'ecrRepositoryName' が未設定です。");
}
if (!envBucketName || !envObjectKey) {
  throw new Error("CDK Context 'envBucketName' または 'envObjectKey'（S3 env）が未設定です。");
}
if (!targetQueueArn || !targetQueueUrl) {
  throw new Error("CDK Context 'targetQueueArn' または 'targetQueueUrl'（既存SQS）が未設定です。");
}
if (!dbUsername || !dbPassword) {
  throw new Error("CDK Context 'dbUsername' または 'dbPassword' が未設定です。");
}

/* =========================
 * 1. Network Stack
 * ========================= */

const networkStack = new NetworkStack(app, 'NetworkStack', { env });

/* =========================
 * 2. ECS Stack（S3 env + 既存SQS 対応）
 * ========================= */

new EcsStack(app, 'EcsStack', {
  env,
  vpc: networkStack.vpc,
  ecsSg: networkStack.ecsSg,

  ecrRepositoryName,
  ecrImageTag,

  envBucketName,
  envObjectKey,

  // ★追加：既存SQS
  targetQueueArn,
  targetQueueUrl,
});

/* =========================
 * 3. RDS Stack（Context 認証）
 * ========================= */

new RdsStack(app, 'RdsStack', {
  env,
  vpc: networkStack.vpc,
  rdsSg: networkStack.rdsSg,
  dbUsername,
  dbPassword,
  dbName,
});
