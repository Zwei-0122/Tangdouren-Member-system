-- ============================================================
-- 优惠券「活动前缀」（PRD v1.1 增量）
--
-- 背景：店铺按活动发券，希望券码带活动标识（新生周 WELCOME…、中秋 LUCKY…）。
--       这推翻了 PRD v1.0「不允许店员自定义优惠码」的决定，故列改为可自定义前缀。
--
-- 说明：
--   1) 前缀由店员自定义（2-8 位大写字母数字），后缀仍由系统随机生成（5 位）。
--      后缀保持随机、不做顺序号：递增数字可被枚举，明确否决。
--   2) 存量券全部是 TD + 8 位，默认值 'TD' 即可覆盖回填，无需单独 UPDATE。
--   3) code 的唯一索引（idx_coupons_code，013 建）保持不动，继续作为撞码兜底。
--   4) 应用访问 coupons 全部走 service role（lib/supabase/admin.ts），因此
--      coupon_prefix_usage() 只授权给 service_role，anon / authenticated 无法经
--      PostgREST 调用（RLS 已在 013 为 coupons 启用，本文件不重复开）。
-- ============================================================

-- ── 1. 新增列 ────────────────────────────────────────────────────────────────

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS code_prefix TEXT NOT NULL DEFAULT 'TD';

-- ── 2. 前缀格式约束 ──────────────────────────────────────────────────────────

-- 格式：2-8 位大写字母或数字；同时校验与 code 的一致性（code 必然以该前缀开头），
-- 防止将来某条写入路径漏填 code_prefix 造成两者不一致。
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_code_prefix_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_code_prefix_check
  CHECK (
    code_prefix ~ '^[A-Z0-9]{2,8}$'
    AND left(code, length(code_prefix)) = code_prefix
  );

-- ── 3. 索引（按前缀筛选 + 前缀使用统计）─────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_coupons_code_prefix ON coupons(code_prefix);

-- ── 4. 已用前缀列表（供生成弹窗快捷复用）───────────────────────────────────

-- PostgREST 在本项目禁用了聚合函数（PGRST123），GROUP BY 必须落在数据库里。
-- 返回每个前缀的使用张数与最近使用时间，按最近使用倒序。
CREATE OR REPLACE FUNCTION coupon_prefix_usage()
RETURNS TABLE (code_prefix TEXT, uses BIGINT, last_created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.code_prefix,
         count(*)::bigint,
         max(c.created_at)
  FROM coupons c
  GROUP BY c.code_prefix
  ORDER BY max(c.created_at) DESC
$$;

REVOKE EXECUTE ON FUNCTION coupon_prefix_usage() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION coupon_prefix_usage() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION coupon_prefix_usage() TO service_role;
