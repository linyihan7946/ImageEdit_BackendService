import { Request, Response, Router } from 'express';
import { cosUploader } from '../cos-upload';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, existsSync } from 'fs';
import path from 'path';

const router = Router();

// 接收Base64图片并上传到COS的路由
router.post('/upload-base64-to-cos', async (req: Request, res: Response) => {
  try {
    const {
      imageBase64: base64Data,
      imageType: fileType = 'jpg',
      isChunk = false,
      fileId,
      chunkIndex,
      totalChunks,
      merge = false
    } = req.body;

    // 记录请求参数信息（避免记录完整的base64数据）
    console.log('收到Base64数据请求，isChunk:', isChunk, 'merge:', merge);

    // 处理分块上传逻辑
    if (isChunk) {
      if (merge) {
        // 处理合并请求
        console.log(`收到合并请求，fileId: ${fileId}`);

        if (!fileId) {
          return res.status(400).json({
            success: false,
            message: '缺少fileId参数'
          });
        }

        try {
          // 创建临时目录用于存储分块
          const tempDir = path.join(__dirname, '../../temp', fileId);

          // 检查临时目录是否存在
          if (!existsSync(tempDir)) {
            console.error(`临时目录不存在: ${tempDir}`);
            return res.status(404).json({
              success: false,
              message: '分块数据不存在，请重新上传'
            });
          }

          // 读取所有分块文件
          const chunkFiles = readdirSync(tempDir);
          if (chunkFiles.length === 0) {
            console.error('没有找到分块文件');
            return res.status(404).json({
              success: false,
              message: '没有找到分块文件'
            });
          }

          // 按索引排序分块文件
          chunkFiles.sort((a: string, b: string) => {
            const indexA = parseInt(a.split('_')[1]);
            const indexB = parseInt(b.split('_')[1]);
            return indexA - indexB;
          });

          // 合并所有分块数据
          const buffers: Buffer[] = [];
          for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(tempDir, chunkFile);
            const chunkBuffer = readFileSync(chunkPath);
            buffers.push(chunkBuffer);

            // 删除已读取的分块文件
            unlinkSync(chunkPath);
          }

          // 合并所有Buffer
          const mergedBuffer = Buffer.concat(buffers);
          console.log(`分块合并完成，总大小: ${mergedBuffer.length} 字节`);

          // 删除临时目录
          rmdirSync(tempDir);

          // 生成文件名并上传到COS
          const fileName = `upload/chunk_merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileType}`;
          console.log('开始上传合并后的文件到COS:', fileName);

          // 调用cosUploader上传合并后的数据
          // 使用正确的参数格式调用现有的uploadBuffer方法
          const fileUrl = await cosUploader.uploadBuffer(
            mergedBuffer,
            fileName,
            { contentType: `image/${fileType}` }
          );

          console.log('合并文件上传到COS成功，URL:', fileUrl);

          // 返回成功结果
          res.json({
            success: true,
            message: '分块合并成功并上传到COS',
            data: {
              fileUrl: fileUrl,
              timestamp: new Date().toISOString(),
              fileSize: mergedBuffer.length,
              chunksCount: chunkFiles.length
            }
          });
        } catch (mergeError) {
          console.error('合并分块失败:', mergeError);
          res.status(500).json({
            success: false,
            message: `合并分块失败: ${mergeError instanceof Error ? mergeError.message : String(mergeError)}`
          });
        }
      } else {
        // 处理单个分块上传
        console.log(`收到分块 ${chunkIndex}/${totalChunks}，fileId: ${fileId}`);

        if (!fileId || chunkIndex === undefined || !totalChunks) {
          return res.status(400).json({
            success: false,
            message: '缺少分块上传必要参数'
          });
        }

        if (!base64Data) {
          return res.status(400).json({
            success: false,
            message: '缺少Base64数据'
          });
        }

        // 将Base64数据转换为Buffer
        const buffer = Buffer.from(base64Data, 'base64');
        console.log(`分块 ${chunkIndex} 转换后的Buffer大小:`, buffer.length);

        // 创建临时目录用于存储分块
        const tempDir = path.join(__dirname, '../../temp', fileId);
        if (!existsSync(tempDir)) {
          mkdirSync(tempDir, { recursive: true });
        }

        // 将分块保存到临时文件
        const chunkFilePath = path.join(tempDir, `chunk_${chunkIndex}.bin`);
        writeFileSync(chunkFilePath, buffer);
        console.log(`分块 ${chunkIndex} 已保存到: ${chunkFilePath}`);

        res.json({
          success: true,
          message: `分块 ${chunkIndex} 上传成功`,
          data: {
            chunkIndex,
            totalChunks,
            fileId
          }
        });
      }
    } else {
      // 处理单块上传逻辑
      console.log('收到Base64图片上传请求');

      // 参数验证
      if (!base64Data) {
        return res.status(400).json({
          success: false,
          message: '缺少必要参数: imageBase64'
        });
      }

      // 检查请求体大小（用于调试大文件）
      const requestSize = JSON.stringify(req.body).length;
      console.log(`请求体大小: ${(requestSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Base64字符串长度: ${base64Data.length}`);

      // 验证Base64格式
      if (!/^([A-Za-z0-9+/=]|data:image\/[^;]+;base64,)+$/.test(base64Data)) {
        return res.status(400).json({
          success: false,
          message: '无效的Base64字符串格式'
        });
      }

      // 处理大Base64数据
      // 对于超大Base64，建议使用分块上传
      if (base64Data.length > 10 * 1024 * 1024) { // 10MB
        console.warn('警告: 接收到超大Base64数据，建议使用分块上传');
      }

      // 上传Base64到COS
      console.log('开始上传Base64数据到COS...');
      const fileUrl = await cosUploader.uploadBase64(
        base64Data,
        `.${fileType}`,
        {
          contentType: `image/${fileType}`,
          // 对于大数据，可以添加进度回调
          onProgress: (progressData: { loaded: number; total: number; speed: number }) => {
            const percent = ((progressData.loaded / progressData.total) * 100).toFixed(2);
            const speed = (progressData.speed / 1024).toFixed(2); // KB/s
            console.log(`上传进度: ${percent}%, 速度: ${speed} KB/s`);
          }
        }
      );

      console.log('Base64上传成功，生成的文件URL:', fileUrl);

      // 返回成功响应
      return res.json({
        success: true,
        message: 'Base64图片上传到COS成功',
        data: {
          fileUrl: fileUrl,
          timestamp: new Date().toISOString(),
          base64Length: base64Data.length
        }
      });
    }
  } catch (error) {
    console.error('Base64图片上传到COS失败:', error);

    // 处理不同类型的错误
    if (error instanceof Error) {
      if (error.message.includes('Base64')) {
        return res.status(400).json({
          success: false,
          message: `Base64处理失败: ${error.message}`
        });
      } else if (error.message.includes('COS')) {
        return res.status(500).json({
          success: false,
          message: `COS上传失败: ${error.message}`
        });
      }
    }

    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '服务器内部错误',
      error: error
    });
  }
});

export default router;