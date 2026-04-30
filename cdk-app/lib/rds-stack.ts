import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
  SecretValue,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';

export interface RdsStackProps extends StackProps {
  vpc: ec2.Vpc;
  rdsSg: ec2.SecurityGroup;
  dbUsername: string;
  dbPassword: string;
  dbName: string;
}

export class RdsStack extends Stack {
  constructor(scope: Construct, id: string, props: RdsStackProps) {
    super(scope, id, props);

    const { vpc, rdsSg, dbUsername, dbPassword, dbName } = props;

    if (!dbUsername || !dbPassword) {
      throw new Error('dbUsername / dbPassword must be set via CDK Context');
    }

    const db = new rds.DatabaseInstance(this, 'Rds', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
      }),

      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [rdsSg],

      // ★ Context から受け取った固定認証
      credentials: rds.Credentials.fromPassword(
        dbUsername,
        SecretValue.unsafePlainText(dbPassword)
      ),

      databaseName: dbName,

      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,

      publiclyAccessible: false,
      multiAz: false,

      backupRetention: Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY, // 検証用
    });

    new CfnOutput(this, 'DbEndpoint', {
      value: db.dbInstanceEndpointAddress,
    });
    new CfnOutput(this, 'DbPort', {
      value: db.dbInstanceEndpointPort,
    });
  }
}
