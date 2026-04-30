import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  // 追加：他スタックから参照できるように公開
  public readonly ecsSg: ec2.SecurityGroup;
  public readonly rdsSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,

      // 個人検証向け：NATなし（ECSはPublicに置く前提）
      natGateways: 0,

      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ECS 用 SG：外部へは HTTPS(443) で送信（LINE等）、inbound は基本不要
    this.ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'Security group for ECS tasks (outbound HTTPS only)',
      allowAllOutbound: false, // ルールを明示
    });

    // 外部 API（LINE Messaging API 等）への HTTPS 通信を許可
    this.ecsSg.addEgressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow outbound HTTPS (TCP 443)'
    );

    // RDS 用 SG：MySQL(3306) は ECS SG からのみ許可
    this.rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'Security group for RDS (allow MySQL only from ECS SG)',
      // allowAllOutbound はデフォルト true。
      // Private Isolated のため経路的に外へは出られません（SGで完全遮断したい場合は false にしてもOK）。
    });

    this.rdsSg.addIngressRule(
      this.ecsSg,
      ec2.Port.tcp(3306),
      'Allow MySQL (3306) from ECS SG only'
    );

    // Outputs（確認用）
    new CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new CfnOutput(this, 'EcsSgId', { value: this.ecsSg.securityGroupId });
    new CfnOutput(this, 'RdsSgId', { value: this.rdsSg.securityGroupId });
  }
}
