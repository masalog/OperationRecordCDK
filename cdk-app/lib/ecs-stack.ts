import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface EcsStackProps extends StackProps {
  vpc: ec2.Vpc;
  ecsSg: ec2.SecurityGroup;

  // ECR
  ecrRepositoryName: string;
  ecrImageTag?: string;

  // S3 .env
  envBucketName: string;
  envObjectKey: string; // 例: "config/app.env"（先頭/なし推奨）

  // ★重要：アプリが実際に読む既存SQS（例: line-webhook-events）
  targetQueueArn: string;
  targetQueueUrl: string;
}

export class EcsStack extends Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const {
      vpc, ecsSg,
      ecrRepositoryName, ecrImageTag,
      envBucketName, envObjectKey,
      targetQueueArn, targetQueueUrl
    } = props;

    if (!ecrRepositoryName?.trim()) throw new Error("ecrRepositoryName が未設定です。");
    if (!envBucketName?.trim() || !envObjectKey?.trim()) throw new Error("envBucketName / envObjectKey が未設定です。");
    if (!targetQueueArn?.trim() || !targetQueueUrl?.trim()) throw new Error("targetQueueArn / targetQueueUrl（既存SQS）が未設定です。");

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    // Logs
    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Task Definition
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 512,
      memoryLimitMiB: 2048,
    });

    // --- 既存ECR ---
    const repo = ecr.Repository.fromRepositoryName(this, 'AppEcrRepo', ecrRepositoryName);
    const tag = ecrImageTag ?? 'latest';

    // --- S3 .env ---
    const envBucket = s3.Bucket.fromBucketName(this, 'EnvBucket', envBucketName);

    // S3 envファイルをECSが取得するための権限は「Execution Role」側（重要） [4](https://github.com/aws/aws-sdk-go-v2/issues/1701)
    taskDef.addToExecutionRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [envBucket.arnForObjects(envObjectKey)],
    }));
    // 推奨（環境によって必要になるケースがある） [4](https://github.com/aws/aws-sdk-go-v2/issues/1701)
    taskDef.addToExecutionRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetBucketLocation'],
      resources: [envBucket.bucketArn],
    }));

    // --- 既存SQS（アプリが実際にReceiveMessageするキュー） ---
    const targetQueue = sqs.Queue.fromQueueAttributes(this, 'TargetQueue', {
      queueArn: targetQueueArn,
      queueUrl: targetQueueUrl,
    });

    // アプリがSQS APIを叩くので「Task Role」に権限が必要 [1](https://zenn.dev/infra_tomo/articles/18d48bd77677f8)
    targetQueue.grantConsumeMessages(taskDef.taskRole);

    // Container
    taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, tag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),

      // 明示的にQUEUE_URLを渡す（アプリが別キュー参照しないように）
      environment: {
        QUEUE_URL: targetQueueUrl,
      },

      // S3の.envを読み込む [3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)
      environmentFiles: [
        ecs.EnvironmentFile.fromBucket(envBucket, envObjectKey),
      ],
    });

    // Fargate Service
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      assignPublicIp: true,
      securityGroups: [ecsSg],
      enableExecuteCommand: true,
    });

    // Outputs
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new CfnOutput(this, 'EcrRepoName', { value: ecrRepositoryName });
    new CfnOutput(this, 'EcrImageTag', { value: tag });
    new CfnOutput(this, 'EnvFileS3', { value: `s3://${envBucketName}/${envObjectKey}` });
    new CfnOutput(this, 'TargetQueueUrl', { value: targetQueueUrl });
    new CfnOutput(this, 'TargetQueueArn', { value: targetQueueArn });
  }
}
