import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// 使用require方式导入，避免TypeScript编译错误
const COS = require('cos-nodejs-sdk-v5');

// 定义接口类型
interface COSOptions {
  SecretId: string;
  SecretKey: string;
}

interface ProgressData {
  loaded: number;
  total: number;
  speed: number;
}

interface COSInstance {
  SecretId?: string;
  SecretKey?: string;
  putObject(params: any, callback: (err: Error | null, data?: any) => void): void;
  getObjectUrl(params: any): string;
  deleteObject(params: any, callback: (err: Error | null) => void): void;
}

// 加载环境变量
dotenv.config();

/**
 * 腾讯云COS文件上传工具
 */
export class CosUploader {
  private cos: any; // 使用any类型避免类型错误
  private bucket: string;
  private region: string;

  constructor() {
    // 从环境变量获取COS配置
    this.cos = new COS({
      SecretId: process.env.TENCENT_COS_SECRET_ID || '',
      SecretKey: process.env.TENCENT_COS_SECRET_KEY || '',
    });

    this.bucket = process.env.TENCENT_COS_BUCKET || '';
    this.region = process.env.TENCENT_COS_REGION || '';

    // 验证必要的配置
    if (!this.cos.SecretId || !this.cos.SecretKey) {
      throw new Error('腾讯云COS密钥未配置，请设置 TENCENT_COS_SECRET_ID 和 TENCENT_COS_SECRET_KEY 环境变量');
    }
    if (!this.bucket || !this.region) {
      throw new Error('腾讯云COS存储桶信息未配置，请设置 TENCENT_COS_BUCKET 和 TENCENT_COS_REGION 环境变量');
    }
  }

  /**
   * 上传文件到腾讯云COS
   * @param filePath 本地文件路径
   * @param cosPath COS存储路径（相对于存储桶根目录）
   * @param options 上传选项
   * @returns 上传成功后的文件URL
   */
  async uploadFile(
    filePath: string,
    cosPath: string,
    options: {
      contentType?: string;
      onProgress?: (progressData: { loaded: number; total: number; speed: number }) => void;
    } = {}
  ): Promise<string> {
    // 确保文件存在
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    // 获取文件信息
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new Error(`路径不是文件: ${filePath}`);
    }

    // 生成存储路径，如果没有指定则使用文件名
    const key = cosPath || path.basename(filePath);

    // 上传文件
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          FilePath: filePath,
          ContentType: options.contentType,
          onProgress: options.onProgress,
        },
        (err: Error | null, data?: any) => {
          if (err) {
            reject(new Error(`COS上传失败: ${err.message}`));
            return;
          }

          // 生成文件URL
          const fileUrl = this.getFileUrl(key);
          resolve(fileUrl);
        }
      );
    });
  }

  /**
   * 上传Buffer到腾讯云COS
   * @param buffer 文件Buffer数据
   * @param cosPath COS存储路径
   * @param options 上传选项
   * @returns 上传成功后的文件URL
   */
  async uploadBuffer(
    buffer: Buffer,
    cosPath: string,
    options: {
      contentType?: string;
      onProgress?: (progressData: { loaded: number; total: number; speed: number }) => void;
    } = {}
  ): Promise<string> {
    // 验证参数
    if (!buffer || buffer.length === 0) {
      throw new Error('上传数据为空');
    }

    if (!cosPath) {
      throw new Error('存储路径不能为空');
    }

    // 上传Buffer
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: cosPath,
          Body: buffer,
          ContentType: options.contentType,
          onProgress: options.onProgress,
        },
        (err: Error | null, data?: any) => {
          if (err) {
            reject(new Error(`COS上传失败: ${err.message}`));
            return;
          }

          // 生成文件URL
          const fileUrl = this.getFileUrl(cosPath);
          resolve(fileUrl);
        }
      );
    });
  }

  /**
   * 生成文件的访问URL
   * @param key 文件在COS中的路径
   * @returns 文件的完整访问URL
   */
  getFileUrl(key: string): string {
    // 生成临时URL，有效期1天
    const signedUrl = this.cos.getObjectUrl({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      Expires: 86400, // 24小时有效期
      Sign: true,
    });

    return signedUrl;
  }

  /**
   * 删除COS中的文件
   * @param cosPath 文件在COS中的路径
   */
  async deleteFile(cosPath: string): Promise<void> {
    if (!cosPath) {
      throw new Error('删除路径不能为空');
    }

    return new Promise((resolve, reject) => {
      this.cos.deleteObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: cosPath,
        },
        (err: Error | null) => {
          if (err) {
            reject(new Error(`COS删除失败: ${err.message}`));
            return;
          }
          resolve();
        }
      );
    });
  }

  /**
   * 生成唯一的文件路径，避免文件名冲突
   * @param originalFileName 原始文件名
   * @param prefix 路径前缀
   * @returns 唯一的文件路径
   */
  generateUniqueFilePath(originalFileName: string, prefix = 'uploads'): string {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(originalFileName) || '';
    const fileName = path.basename(originalFileName, ext);
    
    return `${prefix}/${timestamp}_${randomStr}_${fileName}${ext}`;
  }
}

/**
 * 创建CosUploader实例
 */
export const cosUploader = new CosUploader();