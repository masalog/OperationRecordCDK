# AWS CDK による VPC / ECS(Fargate) / RDS 構築仕様書

## 1. 目的・概要

本仕様書は、AWS Cloud Development Kit（以下 CDK）を利用して以下の AWS リソースを Infrastructure as Code（IaC）として構築・管理する手順および設計方針を定義する。

- Amazon VPC
- Amazon ECS（Fargate）
- Amazon RDS

---

## 2. 前提条件

### 2.1 利用技術

- IaC: AWS CDK v2
- 言語: TypeScript
- リージョン: ap-northeast-1（東京）

### 2.2 事前準備

- AWS アカウント
- Node.js / npm
- AWS CLI
- AWS CDK CLI

---

## 3. 全体アーキテクチャ

```
Internet → ECS(Fargate) → RDS
```

- 外部イベントは Amazon SQS を介して ECS が受信する
- ECS は処理結果を LINE Messaging API に送信する
- RDS は内部状態保持用のデータストアとして利用する

---

## 4. ディレクトリ構成

```
cdk-app/
├── bin/
│   └── app.ts
├── lib/
│   ├── network-stack.ts
│   ├── ecs-stack.ts
│   └── rds-stack.ts
├── package.json
└── tsconfig.json
```

---

## 5. 構築手順

### 5.1 CDK 初期化

```bash
cdk init app --language typescript
npm install
```

---

## 6. VPC 設計

- CIDR: 10.0.0.0/16
- Subnet 構成
  - Public Subnet: ECS 用
  - Private Subnet: RDS 用
- 配置 AZ: 2 AZ

---

## 7. ECS（Fargate）設計

- ALB: 使用しない
- 起動トリガー: Amazon SQS
- 外部通信: LINE Messaging API
- CPU: 512
- Memory: 2 GiB
- Desired Count: 1

---

## 8. RDS 設計

- エンジン: MySQL
- Multi-AZ: 無効
- Subnet: Private Subnet
- 用途: ECS から参照される内部データ管理

---

## 9. デプロイ手順

```bash
cdk bootstrap
cdk deploy
```

---

## 10. 削除手順

```bash
cdk destroy
```

---

## 11. セキュリティ設計

- ECS タスクには専用の Task Role を付与し、Amazon SQS の受信および LINE Messaging API への送信に必要な最小限の権限のみを付与する。
- ECS と RDS はそれぞれ専用の Security Group を割り当てる。
- RDS の Security Group では、ECS の Security Group からの接続のみを許可する。
- 外部通信は ECS からのみ行い、RDS からの直接的な外部通信は行わない。
- ECSが参照する認証情報は S3バケットの.envファイルから取得する。