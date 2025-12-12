import { Request, Response, Router } from 'express';
import { UserBalanceModel, RechargeRecordModel, UserModel } from '../models';
import { transactionDB } from '../database';

const router = Router();

/**
 * 查询用户当前余额
 * GET /api/balance?userId=xxx
 */
router.get('/balance', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少有效的userId参数'
      });
    }

    // 将userId转换为数字类型
    const userIdNum = parseInt(userId as string, 10);
    if (isNaN(userIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'userId必须是有效的数字'
      });
    }

    // 检查用户是否存在
    const user = await UserModel.findById(userIdNum);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 获取用户余额
    const balance = await UserBalanceModel.getBalance(userIdNum);

    res.json({
      success: true,
      message: '查询余额成功',
      data: {
        userId: userIdNum,
        balance: parseFloat(balance.toString()).toFixed(2) // 确保返回两位小数
      }
    });
  } catch (error) {
    console.error('查询余额失败:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '查询余额失败'
    });
  }
});

/**
 * 记录用户充值金额
 * POST /api/recharge
 * Body: { userId: number, amount: number, transactionId?: string, remark?: string }
 */
router.post('/recharge', async (req: Request, res: Response) => {
  try {
    const { userId, amount, transactionId, remark } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '缺少有效的userId参数'
      });
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: '充值金额必须是正数'
      });
    }

    // 验证userId是有效数字
    const userIdNum = typeof userId === 'number' ? userId : parseInt(userId as string, 10);
    if (isNaN(userIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'userId必须是有效的数字'
      });
    }

    // 检查用户是否存在
    const user = await UserModel.findById(userIdNum);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 使用事务确保充值记录和余额更新的一致性
    const result = await transactionDB(async () => {
      // 增加用户余额
      await UserBalanceModel.add(userIdNum, amount);
      
      // 获取更新后的余额
      const newBalance = await UserBalanceModel.getBalance(userIdNum);
      
      // 创建充值记录
      const rechargeRecordId = await RechargeRecordModel.create({
        user_id: userIdNum,
        amount,
        balance_after: parseFloat(newBalance.toString()),
        payment_transaction_id: transactionId || `recharge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 1, // 1表示充值成功
        remark: remark || '用户充值'
      });

      return { newBalance, rechargeRecordId };
    });

    // 记录充值日志
    console.log(`用户${userIdNum}充值成功，金额: ${amount}元，当前余额: ${result.newBalance}元`);

    res.json({
      success: true,
      message: '充值记录成功',
      data: {
        userId: userIdNum,
        rechargeAmount: parseFloat(amount.toFixed(2)),
        newBalance: parseFloat(result.newBalance.toString()).toFixed(2),
        rechargeRecordId: result.rechargeRecordId
      }
    });
  } catch (error) {
    console.error('记录充值失败:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : '记录充值失败'
    });
  }
});

export default router;
