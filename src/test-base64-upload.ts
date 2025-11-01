import { cosUploader } from './cos-upload';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 测试Base64上传功能
async function testBase64Upload() {
  console.log('开始测试Base64上传功能...');
  
  try {
    // 创建一个简单的Base64图片示例（1x1像素的红色PNG图片）
    const testBase64Image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    
    console.log('开始上传Base64图片...');
    const base64Url = await cosUploader.uploadBase64(testBase64Image, 'base64-test.png', {
      contentType: 'image/png'
    });
    
    console.log('✓ Base64上传成功!');
    console.log(`Base64上传URL: ${base64Url}`);
    
  } catch (error) {
    console.error('✗ 测试失败:', error instanceof Error ? error.message : error);
  } finally {
    console.log('测试完成');
  }
}

// 执行测试
testBase64Upload();