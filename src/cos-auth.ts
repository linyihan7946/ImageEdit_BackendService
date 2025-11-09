// cos-auth.ts - 腾讯云COS访问权限实现
// 注意：当前版本使用主密钥方式提供COS访问权限
// 提示：
// 1. 主密钥方式适用于测试环境和开发阶段
// 2. 生产环境建议使用STS AssumeRole方式，并配置正确的IAM角色权限
// 3. 使用前需要安装依赖：npm install cos-nodejs-sdk-v5 tencentcloud-sdk-nodejs-sts --save

import * as dotenv from 'dotenv';
import { Request, Response } from 'express';
import * as crypto from 'crypto';

// 加载环境变量
dotenv.config();

// 导入腾讯云STS SDK
const tencentcloud = require('tencentcloud-sdk-nodejs-sts');
const StsClient = tencentcloud.sts.v20180813.Client;

/**
 * 腾讯云COS临时密钥接口
 */
export interface CosTempKeys {
  secretId: string;
  secretKey: string;
  sessionToken?: string;
  region: string;
  bucket: string;
  expiredTime: number;
  policy: string;
  signature: string;
}

/**
 * 生成腾讯云COS临时授权信息（使用cos-nodejs-sdk-v5内置的STS功能）
 * @returns Promise<CosTempKeys> 临时授权信息
 */
export async function generateCosTempKeys(): Promise<CosTempKeys> {
  return new Promise((resolve, reject) => {
    // 从环境变量获取配置
    const secretId = process.env.TENCENT_COS_SECRET_ID || '';
    const secretKey = process.env.TENCENT_COS_SECRET_KEY || '';
    const bucket = process.env.TENCENT_COS_BUCKET || '';
    const region = process.env.TENCENT_COS_REGION || '';
    const roleArn = process.env.TENCENT_COS_ROLE_ARN || '';
    const roleSessionName = process.env.TENCENT_COS_ROLE_SESSION_NAME || 'cos-upload-session';

    // 验证必要的配置
    if (!secretId || !secretKey) {
      return reject(new Error('腾讯云COS密钥未配置，请设置 TENCENT_COS_SECRET_ID 和 TENCENT_COS_SECRET_KEY 环境变量'));
    }
    if (!bucket || !region) {
      return reject(new Error('腾讯云COS存储桶信息未配置，请设置 TENCENT_COS_BUCKET 和 TENCENT_COS_REGION 环境变量'));
    }

    // 1. 定义上传策略（JSON 格式）
    const policy = {
      expiration: new Date(Date.now() + 3600 * 1000).toISOString(), // 签名有效期 1 小时
      conditions: [
        ['content-length-range', 0, 1024 * 1024 * 100], // 限制文件大小 0-10MB
        ['starts-with', '$key', 'uploads/'], // 限制文件路径前缀（只能上传到 uploads/ 目录）
        ['eq', '$x-cos-debug', 'true'], // 开启调试模式
      ],
    };

    // 2. 将 policy 转为 Base64 编码
    const policyStr = JSON.stringify(policy);
    const encodedPolicy = Buffer.from(policyStr).toString('base64');

    // 3. 用 SecretKey 对 encodedPolicy 进行 HMAC-SHA1 加密，生成 signature
    const signature = crypto
      .createHmac('sha1', secretKey)
      .update(encodedPolicy)
      .digest('base64');

    // 优先使用主密钥方式，避免AssumeRole权限问题
    try {
      // 计算过期时间（当前时间 + 2小时）
      const expiredTime = Math.floor(Date.now() / 1000) + 7200;
      
      // 构造返回数据
      const tempKeys: CosTempKeys = {
        secretId,
        secretKey,
        region,
        bucket,
        expiredTime,
        policy: encodedPolicy,
        signature,
      };
      
      // 记录使用主密钥的信息
      console.info('使用主密钥方式提供COS访问权限');
      console.log('返回临时密钥:', tempKeys);
      resolve(tempKeys);
      
    } catch (error) {
      console.error('生成COS访问密钥失败:', error);
      reject(new Error(`生成COS访问密钥失败: ${(error as Error).message || '未知错误'}`));
    }
    
    /* 
    // STS AssumeRole方式备用实现（当前账号需要AssumeRole权限和角色信任策略配置）
    // 如果需要使用STS方式，请取消注释并配置正确的角色ARN和权限
    if (roleArn) {
      try {
        const client = new StsClient({
          credential: {
            secretId: secretId,
            secretKey: secretKey,
          },
          region: 'ap-guangzhou',
          profile: {
            httpProfile: {
              endpoint: 'sts.tencentcloudapi.com',
            },
          },
        });

        const data = await client.AssumeRole({
          RoleArn: roleArn,
          RoleSessionName: roleSessionName,
          Policy: JSON.stringify(policy),
          DurationSeconds: 7200,
        });
        
        resolve({
          SecretId: data.Credentials.TmpSecretId,
          SecretKey: data.Credentials.TmpSecretKey,
          SessionToken: data.Credentials.SessionToken,
          Region: region,
          Bucket: bucket,
          ExpiredTime: data.ExpiredTime
        });
      } catch (error) {
        console.error('STS AssumeRole失败，降级使用主密钥:', error);
        // 降级使用主密钥
        return resolve({
          SecretId: secretId,
          SecretKey: secretKey,
          Region: region,
          Bucket: bucket,
          ExpiredTime: Math.floor(Date.now() / 1000) + 7200
        });
      }
    }
    */
  });
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
  // app.post('/api/cos/temp-keys', async (req: Request, res: Response) => {
  //   try {
  //     // 生成临时密钥（使用await）
  //     const tempKeys = await generateCosTempKeys();
      
  //     // 返回成功响应
  //     res.json({
  //       code: 0,
  //       message: '获取临时密钥成功',
  //       data: tempKeys
  //     });
  //   } catch (error) {
  //     console.error('生成COS临时密钥失败:', error);
  //     res.status(500).json({
  //       code: -1,
  //       message: error instanceof Error ? error.message : '生成临时密钥失败',
  //       data: null
  //     });
  //   }
  // });
}
