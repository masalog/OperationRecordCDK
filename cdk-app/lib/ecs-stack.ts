import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface EcsStackProps extends StackProps {
  vpc: ec2.Vpc;
  ecsSg: ec2.SecurityGroup;

  // 既存ECR
  ecrRepositoryName: string;
  ecrImageTag?: string;
}

export class EcsStack extends Stack {
  public readonly queue: sqs.Queue;
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;

  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const { vpc, ecsSg } = props;

    // --- 入力値チェック（Context未設定などでハマらないように） ---
    if (!props.ecrRepositoryName || props.ecrRepositoryName.trim().length === 0) {
      throw new Error(
        "ecrRepositoryName が未設定です。cdk.json の context または app.ts から正しい値を渡してください。"
      );
    }
    const ecrImageTag = props.ecrImageTag ?? 'latest';

    // --- SQS（外部イベントをECSが受信）---
    this.queue = new sqs.Queue(this, 'AppQueue', {
      visibilityTimeout: Duration.seconds(300),
      retentionPeriod: Duration.days(4),

      // 個人検証なら DESTROY でOK（本番は要検討）
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- ECS Cluster ---
    this.cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    // --- Logs ---
    const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // --- Task Definition（CPU 512 / Memory 2GiB）---
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 512,
      memoryLimitMiB: 2048,
    });

    // 既存ECR参照
    const repo = ecr.Repository.fromRepositoryName(this, 'AppEcrRepo', props.ecrRepositoryName);

    // コンテナ（ECRからpull）
    taskDef.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repo, ecrImageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'app' }),
      environment: {
        QUEUE_URL: this.queue.queueUrl,
        // LINE_TOKEN などは Secrets Manager 推奨（必要になったらここを拡張）
      },
    });

    // SQS受信権限（最小権限）
    this.queue.grantConsumeMessages(taskDef.taskRole);

    // --- Fargate Service（ALBなし / Desired 1 / Public配置）---
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: 1,

      // Public Subnet に配置
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },

      // NATなしで外部へ出すために Public IP が重要
      assignPublicIp: true,

      securityGroups: [ecsSg],

      // 検証時に便利（ECS Exec）。不要なら false でもOK
      enableExecuteCommand: true,
    });

    // Outputs
    new CfnOutput(this, 'QueueUrl', { value: this.queue.queueUrl });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'ServiceName', { value: this.service.serviceName });
    new CfnOutput(this, 'EcrRepoName', { value: props.ecrRepositoryName });
    new CfnOutput(this, 'EcrImageTag', { value: ecrImageTag });
  }
}
