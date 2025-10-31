import { cosUploader } from './cos-upload';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 测试COS文件上传功能
 * 注意：运行此测试前请确保已配置正确的腾讯云COS环境变量
 */
async function testCosUpload() {
  console.log('开始测试腾讯云COS文件上传功能...');
  
  try {
    // 测试用图片路径（这里假设使用一个实际存在的测试图片）
    // 如果没有实际图片，可以创建一个简单的测试图片或使用现有的图片路径
    const testImagePath = path.join(__dirname, '../test-image.png');
    
    // 检查测试图片是否存在，如果不存在则创建一个简单的测试图片（这里仅做示例）
    if (!fs.existsSync(testImagePath)) {
      console.log(`测试图片不存在，将创建一个简单的文本文件作为测试: ${testImagePath}`);
      
      // 创建一个简单的文本文件作为测试（实际项目中应使用真实图片）
      fs.writeFileSync(testImagePath, 'This is a test file content for COS upload test.');
      console.log('测试文件已创建');
    }
    
    // 生成唯一的COS存储路径
    const cosPath = cosUploader.generateUniqueFilePath('test-image.png', 'test-uploads');
    console.log(`将上传到COS路径: ${cosPath}`);
    
    // 定义上传进度回调
    const onProgress = (progressData: { loaded: number; total: number; speed: number }) => {
      const percent = ((progressData.loaded / progressData.total) * 100).toFixed(2);
      const speed = (progressData.speed / 1024 / 1024).toFixed(2); // MB/s
      console.log(`上传进度: ${percent}%, 速度: ${speed} MB/s`);
    };
    
    // 执行上传
    console.log(`开始上传文件: ${testImagePath}`);
    const fileUrl = await cosUploader.uploadFile(testImagePath, cosPath, {
      contentType: 'image/png', // 假设是PNG图片
      onProgress
    });
    
    // 上传成功
    console.log('✓ 文件上传成功!');
    console.log(`访问URL: ${fileUrl}`);
    
    // 测试获取文件URL功能
    const generatedUrl = cosUploader.getFileUrl(cosPath);
    console.log(`生成的URL: ${generatedUrl}`);
    
    // 提示：如果需要测试删除功能，可以取消下面的注释
    /*
    await cosUploader.deleteFile(cosPath);
    console.log('✓ 文件已删除!');
    */
    
    // 测试Buffer上传功能
    console.log('\n开始测试Buffer上传...');
    const fileBuffer = fs.readFileSync(testImagePath);
    const bufferCosPath = cosUploader.generateUniqueFilePath('buffer-test.png', 'test-uploads');
    const bufferUrl = await cosUploader.uploadBuffer(fileBuffer, bufferCosPath, {
      contentType: 'image/png'
    });
    console.log('✓ Buffer上传成功!');
    console.log(`Buffer上传URL: ${bufferUrl}`);
    
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

// 运行测试
if (require.main === module) {
  testCosUpload();
}