import * as dotenv from 'dotenv';
import { Request, Response } from 'express';

// 加载环境变量
dotenv.config();

// 导入腾讯云STS SDK
const STS = require('tencentcloud-sdk-nodejs-sts') || null;

/**
 * 腾讯云COS临时密钥接口
 */
export interface CosTempKeys {
  SecretId: string;
  SecretKey: string;
  SessionToken?: string;
  Region: string;
  Bucket: string;
  ExpiredTime: number;
}

/**
 * 生成腾讯云COS临时授权信息（使用STS服务）
 * @returns Promise<CosTempKeys> 临时授权信息
 */
export async function generateCosTempKeys(): Promise<CosTempKeys> {
  // 从环境变量获取配置
  const secretId = process.env.TENCENT_COS_SECRET_ID || '';
  const secretKey = process.env.TENCENT_COS_SECRET_KEY || '';
  const bucket = process.env.TENCENT_COS_BUCKET || '';
  const region = process.env.TENCENT_COS_REGION || '';
  const roleArn = process.env.TENCENT_COS_ROLE_ARN || '';
  const roleSessionName = process.env.TENCENT_COS_ROLE_SESSION_NAME || 'cos-upload-session';

  // 验证必要的配置
  if (!secretId || !secretKey) {
    throw new Error('腾讯云COS密钥未配置，请设置 TENCENT_COS_SECRET_ID 和 TENCENT_COS_SECRET_KEY 环境变量');
  }
  if (!bucket || !region) {
    throw new Error('腾讯云COS存储桶信息未配置，请设置 TENCENT_COS_BUCKET 和 TENCENT_COS_REGION 环境变量');
  }
  if (!roleArn && STS) {
    throw new Error('腾讯云STS角色未配置，请设置 TENCENT_COS_ROLE_ARN 环境变量');
  }

  // 如果STS SDK未安装，降级为使用永久密钥（仅用于开发测试）
  if (!STS) {
    console.warn('警告: STS SDK未安装，当前使用的是永久密钥，生产环境请安装STS SDK并使用STS服务生成临时密钥');
    // 计算过期时间（当前时间 + 2小时）
    const expiredTime = Math.floor(Date.now() / 1000) + 7200;
    return {
      SecretId: secretId,
      SecretKey: secretKey,
      Region: region,
      Bucket: bucket,
      ExpiredTime: expiredTime
    };
  }

  try {
    // 创建STS客户端
    const client = new STS.Client({
      credential: {
        SecretId: secretId,
        SecretKey: secretKey,
      },
      region: region,
      profile: {
        httpProfile: {
          endpoint: 'sts.tencentcloudapi.com',
        },
      },
    });

    // 策略内容，限制上传权限
    const policy = {
      version: '2.0',
      statement: [
        {
          action: [
            'name/cos:PutObject',
            'name/cos:InitiateMultipartUpload',
            'name/cos:UploadPart',
            'name/cos:CompleteMultipartUpload'
          ],
          effect: 'allow',
          resource: [
            `qcs::cos:${region}:uid/*:${bucket}/*`
          ]
        }
      ]
    };

    // 请求参数
    const params = {
      RoleArn: roleArn,
      RoleSessionName: roleSessionName,
      Policy: JSON.stringify(policy),
      DurationSeconds: 7200, // 2小时有效期
    };

    // 调用AssumeRole获取临时凭证
    const result = await client.AssumeRole(params);
    
    // 检查返回结果
    if (!result.Credentials) {
      throw new Error('获取STS临时凭证失败：未返回Credentials');
    }

    return {
      SecretId: result.Credentials.TmpSecretId,
      SecretKey: result.Credentials.TmpSecretKey,
      SessionToken: result.Credentials.Token,
      Region: region,
      Bucket: bucket,
      ExpiredTime: Math.floor(result.ExpiredTime)
    };
  } catch (error) {
    console.error('生成STS临时密钥失败:', error);
    // // 如果STS调用失败，返回友好错误信息
    // if (error instanceof Error && error.code === 'InvalidParameter.RoleArnError') {
    //   throw new Error('STS角色ARN格式错误，请检查 TENCENT_COS_ROLE_ARN 环境变量配置');
    // } else if (error instanceof Error && error.code === 'InvalidParameter.RoleSessionNameError') {
    //   throw new Error('角色会话名称错误，请检查 TENCENT_COS_ROLE_SESSION_NAME 环境变量配置');
    // }
    throw new Error(`生成STS临时密钥失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/**
 * 设置COS临时密钥路由
 * @param app Express应用实例
 */
export function setupCosAuthRoute(app: any): void {
  /**
   * 获取腾讯云COS临时授权信息接口
   * GET /api/cos/temp-keys
   */
  app.get('/api/cos/temp-keys', async (req: Request, res: Response) => {
    try {
      // 生成临时密钥（使用await）
      const tempKeys = await generateCosTempKeys();
      
      // 返回成功响应
      res.json({
        code: 0,
        message: '获取临时密钥成功',
        data: tempKeys
      });
    } catch (error) {
      console.error('生成COS临时密钥失败:', error);
      res.status(500).json({
        code: -1,
        message: error instanceof Error ? error.message : '生成临时密钥失败',
        data: null
      });
    }
  });

  /**
   * 获取腾讯云COS临时授权信息接口（POST版本）
   * POST /api/cos/temp-keys
   */
  app.post('/api/cos/temp-keys', async (req: Request, res: Response) => {
    try {
      // 生成临时密钥（使用await）
      const tempKeys = await generateCosTempKeys();
      
      // 返回成功响应
      res.json({
        code: 0,
        message: '获取临时密钥成功',
        data: tempKeys
      });
    } catch (error) {
      console.error('生成COS临时密钥失败:', error);
      res.status(500).json({
        code: -1,
        message: error instanceof Error ? error.message : '生成临时密钥失败',
        data: null
      });
    }
  });
}
