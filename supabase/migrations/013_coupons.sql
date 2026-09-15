-- ============================================================
-- 优惠券生成与核销系统（MVP v1.0）
-- 1) 新表 coupons
-- 2) timer_sessions 优惠快照字段
-- 3) 结算核销 / 撤销结算 原子事务函数
-- 说明：金额一律由服务端计算，核销与结算在同一事务内完成。
-- ============================================================

-- ── 1. coupons ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coupons (
  coupon_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL,                 -- 大写存储
  discount_type       TEXT NOT NULL,                 -- fixed_amount | percentage_off | time_minutes
  discount_value      NUMERIC(10,2) NOT NULL,        -- 金额(£) / 减免百分比 / 减免分钟数
  expires_at          TIMESTAMPTZ NULL,              -- NULL = 永久有效
  redeemed_at         TIMESTAMPTZ NULL,
  redeemed_by         TEXT NULL,
  redeemed_session_id TEXT NULL REFERENCES timer_sessions(session_id) ON DELETE RESTRICT,
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 优惠类型
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_discount_type_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_discount_type_check
  CHECK (discount_type IN ('fixed_amount', 'percentage_off', 'time_minutes'));

-- 优惠值：> 0；百分比 < 100；时长券必须是 30 分钟的整数倍
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_discount_value_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_discount_value_check
  CHECK (
    discount_value > 0
    AND (discount_type <> 'percentage_off' OR discount_value < 100)
    AND (
      discount_type <> 'time_minutes'
      OR (discount_value = trunc(discount_value) AND mod(discount_value::bigint, 30) = 0)
    )
  );

-- 优惠码统一大写
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_code_upper_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_code_upper_check CHECK (code = upper(code));

-- 核销字段要么全空，要么成组出现
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_redemption_consistency_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_redemption_consistency_check
  CHECK (
    (redeemed_at IS NULL     AND redeemed_session_id IS NULL     AND redeemed_by IS NULL)
    OR
    (redeemed_at IS NOT NULL AND redeemed_session_id IS NOT NULL AND redeemed_by IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code          ON coupons(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_redeemed_session
  ON coupons(redeemed_session_id) WHERE redeemed_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coupons_created_at  ON coupons(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coupons_expires_at  ON coupons(expires_at);
CREATE INDEX IF NOT EXISTS idx_coupons_redeemed_at ON coupons(redeemed_at);

-- RLS：仅登录管理员可操作（实际 API 使用 service role client）
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin all coupons" ON coupons;
CREATE POLICY "Admin all coupons" ON coupons
  FOR ALL USING (auth.role() = 'authenticated');

-- ── 2. timer_sessions 结算与优惠快照字段 ──────────────────────────────────────

ALTER TABLE timer_sessions
  ADD COLUMN IF NOT EXISTS coupon_id                  UUID NULL REFERENCES coupons(coupon_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS coupon_code_snapshot       TEXT NULL,
  ADD COLUMN IF NOT EXISTS discount_type_snapshot     TEXT NULL,
  ADD COLUMN IF NOT EXISTS discount_value_snapshot    NUMERIC(10,2) NULL,
  ADD COLUMN IF NOT EXISTS discount_amount_gbp        NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_discount_amount_gbp    NUMERIC(8,2) NULL,
  ADD COLUMN IF NOT EXISTS discounted_billing_minutes INTEGER NULL;

CREATE INDEX IF NOT EXISTS idx_timer_sessions_coupon ON timer_sessions(coupon_id);

-- ── 3. 原子结算 + 核销 ────────────────────────────────────────────────────────
-- 无券结算与用券结算共用此函数：核销与结算发生在同一事务，任一失败全部回滚。
-- 金额由服务端（TypeScript 计价函数）计算后传入，函数内对可独立推导的部分
-- 用数据库自身的数据重新核对，不信任客户端传来的任何金额。
--   固定抵扣：优惠金额必须等于 min(券面金额, 订单原价)
--   百分比  ：优惠金额必须等于 round(订单原价 pence × 百分比 / 100)
--   时长减免：计费时长必须超过 60 分钟，且优惠金额落在 [0, 原价] 区间
--             （半小时续时单价保留在 lib/timer/pricing.ts，避免在 SQL 里重复业务常量）

DROP FUNCTION IF EXISTS public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.settle_timer_session(
  p_session_id            TEXT,
  p_settled_by            TEXT,
  p_settlement_note       TEXT    DEFAULT NULL,
  p_coupon_code           TEXT    DEFAULT NULL,
  p_discount_amount_pence INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session     timer_sessions%ROWTYPE;
  v_coupon      coupons%ROWTYPE;
  v_code        TEXT;
  v_pre_pence   INTEGER;
  v_expect      INTEGER;
  v_final_pence INTEGER;
BEGIN
  -- 1. 锁定订单
  SELECT * INTO v_session FROM timer_sessions WHERE session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.status <> 'completed' THEN
    RAISE EXCEPTION 'SESSION_NOT_COMPLETED' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.is_settled THEN
    RAISE EXCEPTION 'SESSION_ALREADY_SETTLED' USING ERRCODE = 'P0001';
  END IF;

  v_pre_pence := COALESCE(ROUND(v_session.amount_gbp * 100)::INTEGER, 0);

  -- 2. 无券结算
  IF p_coupon_code IS NULL OR btrim(p_coupon_code) = '' THEN
    UPDATE timer_sessions SET
      is_settled                 = TRUE,
      actual_amount_gbp          = v_session.amount_gbp,
      settlement_note            = p_settlement_note,
      settled_at                 = NOW(),
      settled_by                 = p_settled_by,
      coupon_id                  = NULL,
      coupon_code_snapshot       = NULL,
      discount_type_snapshot     = NULL,
      discount_value_snapshot    = NULL,
      discount_amount_gbp        = 0,
      pre_discount_amount_gbp    = v_session.amount_gbp,
      discounted_billing_minutes = NULL
    WHERE session_id = p_session_id
    RETURNING * INTO v_session;

    RETURN to_jsonb(v_session);
  END IF;

  v_code := upper(btrim(p_coupon_code));

  -- 3. 锁定优惠券并校验状态
  SELECT * INTO v_coupon FROM coupons WHERE code = v_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COUPON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_coupon.redeemed_at IS NOT NULL THEN
    RAISE EXCEPTION 'COUPON_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;
  IF v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at < NOW() THEN
    RAISE EXCEPTION 'COUPON_EXPIRED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM coupons
     WHERE redeemed_session_id = p_session_id AND coupon_id <> v_coupon.coupon_id
  ) THEN
    RAISE EXCEPTION 'SESSION_ALREADY_HAS_COUPON' USING ERRCODE = 'P0001';
  END IF;

  -- 4. 复核服务端计算出的优惠金额
  IF p_discount_amount_pence IS NULL THEN
    RAISE EXCEPTION 'COUPON_DISCOUNT_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF v_coupon.discount_type = 'fixed_amount' THEN
    v_expect := LEAST(ROUND(v_coupon.discount_value * 100)::INTEGER, v_pre_pence);
    IF p_discount_amount_pence <> v_expect THEN
      RAISE EXCEPTION 'COUPON_DISCOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_coupon.discount_type = 'percentage_off' THEN
    v_expect := ROUND(v_pre_pence * v_coupon.discount_value / 100)::INTEGER;
    IF p_discount_amount_pence <> v_expect THEN
      RAISE EXCEPTION 'COUPON_DISCOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

  ELSE  -- time_minutes
    -- 时长券：首小时不可减免；优惠金额按「每 30 分钟续时价」由服务端统一计算。
    -- 具体单价常量保留在 lib/timer/pricing.ts（唯一来源），此处只校验结构性约束：
    -- 计费时长必须超过 60 分钟，且优惠金额落在 [0, 原价] 区间（见下方通用校验）。
    IF v_session.billing_minutes IS NULL OR v_session.billing_minutes <= 60 THEN
      RAISE EXCEPTION 'COUPON_TIME_NOT_APPLICABLE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_final_pence := v_pre_pence - p_discount_amount_pence;
  IF p_discount_amount_pence < 0 OR v_final_pence < 0 THEN
    RAISE EXCEPTION 'COUPON_DISCOUNT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  -- 5. 写入订单结算与快照
  UPDATE timer_sessions SET
    is_settled                 = TRUE,
    actual_amount_gbp          = ROUND(v_final_pence / 100.0, 2),
    settlement_note            = p_settlement_note,
    settled_at                 = NOW(),
    settled_by                 = p_settled_by,
    coupon_id                  = v_coupon.coupon_id,
    coupon_code_snapshot       = v_coupon.code,
    discount_type_snapshot     = v_coupon.discount_type,
    discount_value_snapshot    = v_coupon.discount_value,
    discount_amount_gbp        = ROUND(p_discount_amount_pence / 100.0, 2),
    pre_discount_amount_gbp    = v_session.amount_gbp,
    discounted_billing_minutes = NULL   -- v1.0 时长券不重算计费时长，该列保留备用
  WHERE session_id = p_session_id;

  -- 6. 核销优惠券
  UPDATE coupons SET
    redeemed_at         = NOW(),
    redeemed_by         = p_settled_by,
    redeemed_session_id = p_session_id
  WHERE coupon_id = v_coupon.coupon_id;

  SELECT * INTO v_session FROM timer_sessions WHERE session_id = p_session_id;
  RETURN to_jsonb(v_session);
END;
$$;

-- ── 4. 撤销结算（并恢复优惠券）───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.unsettle_timer_session(
  p_session_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session timer_sessions%ROWTYPE;
  v_coupon  coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM timer_sessions WHERE session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_session.is_settled THEN
    RAISE EXCEPTION 'SESSION_NOT_SETTLED' USING ERRCODE = 'P0001';
  END IF;

  -- 恢复优惠券（仅当该券确实由本订单核销）
  IF v_session.coupon_id IS NOT NULL THEN
    SELECT * INTO v_coupon FROM coupons WHERE coupon_id = v_session.coupon_id FOR UPDATE;
    IF FOUND THEN
      IF v_coupon.redeemed_session_id IS DISTINCT FROM p_session_id OR v_coupon.redeemed_at IS NULL THEN
        RAISE EXCEPTION 'COUPON_REDEMPTION_MISMATCH' USING ERRCODE = 'P0001';
      END IF;
      UPDATE coupons SET
        redeemed_at         = NULL,
        redeemed_by         = NULL,
        redeemed_session_id = NULL
      WHERE coupon_id = v_coupon.coupon_id;
    END IF;
  END IF;

  UPDATE timer_sessions SET
    is_settled                 = FALSE,
    actual_amount_gbp          = NULL,
    actual_amount_cny          = NULL,
    settlement_note            = NULL,
    settled_at                 = NULL,
    settled_by                 = NULL,
    coupon_id                  = NULL,
    coupon_code_snapshot       = NULL,
    discount_type_snapshot     = NULL,
    discount_value_snapshot    = NULL,
    discount_amount_gbp        = 0,
    pre_discount_amount_gbp    = NULL,
    discounted_billing_minutes = NULL
  WHERE session_id = p_session_id
  RETURNING * INTO v_session;

  RETURN to_jsonb(v_session);
END;
$$;

-- ── 5. 权限：仅 service role 可执行（避免前端直接调用 RPC）────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.unsettle_timer_session(TEXT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.unsettle_timer_session(TEXT) TO service_role';
  END IF;
END $$;
