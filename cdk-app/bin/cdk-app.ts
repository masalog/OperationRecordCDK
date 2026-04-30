#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

import { NetworkStack } from '../lib/network-stack';
import { EcsStack } from '../lib/ecs-stack';

const app = new cdk.App();

// 環境設定（全スタック共通）
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
};

// ★ CDK Context から取得（cdk.json の context か、-c で渡す）
const ecrRepositoryName = app.node.tryGetContext('ecrRepositoryName') as string;
const ecrImageTag = (app.node.tryGetContext('ecrImageTag') as string) ?? 'latest';

// ★ 設定漏れを即検知（ハードコードを避けつつ、原因が分かりやすい）
if (!ecrRepositoryName) {
  throw new Error(
    "CDK Context 'ecrRepositoryName' が未設定です。cdk.json の context に ecrRepositoryName を追加するか、cdk deploy -c ecrRepositoryName=... で指定してください。"
  );
}

// 1. Network Stack（VPC / SG）
const networkStack = new NetworkStack(app, 'NetworkStack', {
  env,
});

// 2. ECS Stack（Public配置 / SQS受信 / ECRイメージ）
new EcsStack(app, 'EcsStack', {
  env,
  vpc: networkStack.vpc,
  ecsSg: networkStack.ecsSg,
  ecrRepositoryName,
  ecrImageTag,
});