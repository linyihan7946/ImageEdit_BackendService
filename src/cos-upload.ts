import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

// 为COS SDK定义接口类型
interface COSOptions {
  SecretId: string;
  SecretKey: string;
}

interface COS {
  SecretId?: string;
  SecretKey?: string;
  putObject(params: any, callback: (err: Error | null, data?: any) => void): void;
  getObjectUrl(params: any): string;
  deleteObject(params: any, callback: (err: Error | null) => void): void;
}

// 使用require导入并指定类型
const COS = require('cos-nodejs-sdk-v5') as new (options: COSOptions) => COS;

// 加载环境变量
dotenv.config();

/**
 * 腾讯云COS文件上传工具
 */
export class CosUploader {
  private cos: COS;
  private bucket: string;
  private region: string;

  constructor() {
    console.log(process.env);
    // 从环境变量获取COS配置
    this.cos = new COS({
      SecretId: process.env.TENCENT_COS_SECRET_ID || '',
      SecretKey: process.env.TENCENT_COS_SECRET_KEY || '',
    });

    this.bucket = process.env.TENCENT_COS_BUCKET || '';
    this.region = process.env.TENCENT_COS_REGION || '';

    // 验证必要的配置
    if (!process.env.TENCENT_COS_SECRET_ID || !process.env.TENCENT_COS_SECRET_KEY) {
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
      // onProgress?: (progressData: { loaded: number; total: number; speed: number }) => void;
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

    // 读取文件内容
    const fileContent = fs.readFileSync(filePath);
    
    // 上传文件
    return new Promise((resolve, reject) => {
      this.cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Body: fileContent,
          ContentType: options.contentType,
          // onProgress: options.onProgress,
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
   * 生成唯一的文件路径，基于文件内容计算md5码
   * @param filePath 文件路径，用于读取文件内容计算md5
   * @param prefix 路径前缀
   * @returns 唯一的文件路径
   */
  generateUniqueFilePath(filePath: string, prefix = 'uploads'): string {
    // 读取文件内容并计算md5
    const fileContent = fs.readFileSync(filePath);
    const md5Hash = this.calculateMD5(fileContent);
    const ext = path.extname(filePath) || '';
    return `${prefix}/${md5Hash}${ext}`;
  }
  
  /**
   * 为Buffer数据生成唯一的文件路径
   * @param originalFileName 原始文件名
   * @param buffer 文件Buffer数据
   * @param prefix 路径前缀
   * @returns 唯一的文件路径
   */
  generateUniqueFilePathForBuffer(originalFileName: string, buffer: Buffer, prefix = 'uploads'): string {
    const md5Hash = this.calculateMD5(buffer);
    const ext = path.extname(originalFileName) || '';
    
    return `${prefix}/${md5Hash}${ext}`;
  }
  
  /**
   * 计算数据的MD5哈希值
   * @param data 文件内容或Buffer数据
   * @returns MD5哈希值（十六进制字符串）
   */
  private calculateMD5(data: Buffer): string {
    const md5Sum = crypto.createHash('md5');
    md5Sum.update(data);
    return md5Sum.digest('hex');
  }
}

/**
 * 创建CosUploader实例
 */
export const cosUploader = new CosUploader();


// 测试文件上传
async function testCosUpload() {
  console.log('开始测试腾讯云COS文件上传功能...');
  
  try {
    // 测试用图片路径（这里假设使用一个实际存在的测试图片）
    // 如果没有实际图片，可以创建一个简单的测试图片或使用现有的图片路径
    const testImagePath = path.join(__dirname, '../images/upload-test.png');
    
    // 检查测试图片是否存在，如果不存在则创建一个简单的测试图片（这里仅做示例）
    if (!fs.existsSync(testImagePath)) {
      console.log(`测试图片不存在，将创建一个简单的文本文件作为测试: ${testImagePath}`);
      return;
    }
    
    // 生成唯一的COS存储路径（使用文件内容的md5）
    const cosPath = cosUploader.generateUniqueFilePath(testImagePath, 'test-uploads');
    console.log(`将上传到COS路径: ${cosPath}`);
    
    // 定义上传进度回调
    // const onProgress = (progressData: { loaded: number; total: number; speed: number }) => {
    //   const percent = ((progressData.loaded / progressData.total) * 100).toFixed(2);
    //   const speed = (progressData.speed / 1024 / 1024).toFixed(2); // MB/s
    //   console.log(`上传进度: ${percent}%, 速度: ${speed} MB/s`);
    // };
    
    // 执行上传
    console.log(`开始上传文件: ${testImagePath}`);
    const fileUrl = await cosUploader.uploadFile(testImagePath, cosPath, {
      contentType: 'image/png', // 假设是PNG图片
      // onProgress
    });
    
    // 上传成功
    console.log('✓ 文件上传成功!');
    console.log(`访问URL: ${fileUrl}`);
    
    // // 测试获取文件URL功能
    // const generatedUrl = cosUploader.getFileUrl(cosPath);
    // console.log(`生成的URL: ${generatedUrl}`);
    
    // // 测试Buffer上传功能
    // console.log('\n开始测试Buffer上传...');
    // const fileBuffer = fs.readFileSync(testImagePath);
    // // 使用基于buffer内容的方法生成唯一路径
    // const bufferCosPath = cosUploader.generateUniqueFilePathForBuffer('buffer-test.png', fileBuffer, 'test-uploads');
    // const bufferUrl = await cosUploader.uploadBuffer(fileBuffer, bufferCosPath, {
    //   contentType: 'image/png'
    // });
    // console.log('✓ Buffer上传成功!');
    // console.log(`Buffer上传URL: ${bufferUrl}`);
    
  } catch (error) {
    console.error('✗ 测试失败:', error instanceof Error ? error.message : error);
    
    // 检查是否是环境变量配置问题
    if (error instanceof Error && error.message.includes('环境变量')) {
      console.log('提示: 请确保已在.env文件中配置以下环境变量:');
      console.log('  - TENCENT_COS_SECRET_ID');
      console.log('  - TENCENT_COS_SECRET_KEY');
      console.log('  - TENCENT_COS_BUCKET');
      console.log('  - TENCENT_COS_REGION');
    }
  } finally {
    console.log('测试完成');
  }
}

// testCosUpload();