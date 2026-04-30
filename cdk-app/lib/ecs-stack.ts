import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';

// ★追加
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface EcsStackProps extends StackProps {
  vpc: ec2.Vpc;
  ecsSg: ec2.SecurityGroup;

  // 既存ECR
  ecrRepositoryName: string;
  ecrImageTag?: string;

  // ★追加：S3の.envファイル場所
  envBucketName: string;   // 例: "my-config-bucket"
  envObjectKey: string;    // 例: "config/app.env"
}

export class EcsStack extends Stack {
  public readonly queue: sqs.Queue;
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const { vpc, ecsSg } = props;

    if (!props.ecrRepositoryName || props.ecrRepositoryName.trim().length === 0) {
      throw new Error("ecrRepositoryName が未設定です。");
    }
    if (!props.envBucketName || !props.envObjectKey) {
      throw new Error("envBucketName / envObjectKey（S3の.env指定）が未設定です。");
    }

    const ecrImageTag = props.ecrImageTag ?? 'latest';

    // --- SQS ---
    this.queue = new sqs.Queue(this, 'AppQueue', {
      visibilityTimeout: Duration.seconds(300),
      retentionPeriod: Duration.days(4),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- ECS Cluster ---
    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    // --- Logs ---
    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Task Definition ---
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 512,
      memoryLimitMiB: 2048,
    });

    // 既存ECR参照
    const repo = ecr.Repository.fromRepositoryName(this, 'AppEcrRepo', props.ecrRepositoryName);

    // ★ S3バケット参照（既存バケット想定）
    const envBucket = s3.Bucket.fromBucketName(this, 'EnvBucket', props.envBucketName);

    // ★ envファイルをS3から読むための権限（Execution Roleに付与）
    taskDef.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [envBucket.arnForObjects(props.envObjectKey)],
      })
    );

    // コンテナ（ECRからpull）
    taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, ecrImageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),

      // 既存の環境変数
      environment: {
        QUEUE_URL: this.queue.queueUrl,
      },

      // ★ここが核心：S3の.envを読み込む
      environmentFiles: [
        ecs.EnvironmentFile.fromBucket(envBucket, props.envObjectKey),
      ],
    });

    // SQS受信権限（最小権限）
    this.queue.grantConsumeMessages(taskDef.taskRole);

    // --- Fargate Service ---
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
    new CfnOutput(this, 'QueueUrl', { value: this.queue.queueUrl });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new CfnOutput(this, 'EcrRepoName', { value: props.ecrRepositoryName });
    new CfnOutput(this, 'EcrImageTag', { value: ecrImageTag });
    new CfnOutput(this, 'EnvFileS3', { value: `s3://${props.envBucketName}/${props.envObjectKey}` });
  }
}