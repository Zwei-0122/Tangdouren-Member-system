--  
-- NOTE: the head of this file is kept ASCII-only on purpose.
-- Tooling that sniffs the first 8192 bytes as UTF-8 misreads a file whose
-- multibyte characters straddle that boundary. Do not reorder this header
-- without re-checking that the file is still seen as text.
-- ============================================================
-- Tangdouren Club 会员系统 v1.2 — 第 3 步：奖励引擎与结算接入
-- 依据：《Tangdouren Club 会员系统 PRD v1》第 6、7、9、10、11、18、19、20、21 节
--
-- 范围：
--   1) 新表 member_rewards（奖励解锁与核销）与 member_benefits（VIP Month）
--   2) 新视图 member_visit_days（Lifetime Visits 与 Reward Progress 的唯一口径）
--   3) 新函数 member_vip_active()、ensure_member_rewards()
--   4) 扩展 settle_timer_session / unsettle_timer_session，接入会员折扣
--   5) 后台动作函数 link_timer_session_to_member()、activate_member_vip()
--
-- 设计要点：
--   1) 进度不落计数器。Lifetime Visits = 会员已结算订单的伦敦日期去重计数；
--      Reward Progress = 同样的计数但只认 reward_eligible 为真的访日（PRD 20）。
--   2) 解锁幂等靠 UNIQUE(member_id, reward_type, cycle_index) + ON CONFLICT DO NOTHING，
--      重复结算或并发调用都不会多发一张（PRD 19.3）。
--   3) 折扣来源是单选枚举（none / coupon / member_reward / vip_month），从结构上排除叠加（PRD 21）。
--   4) 金额仍由 TypeScript 先算（lib/coupon/coupon.ts），SQL 用自己查到的券或奖励记录复核，
--      对不上抛错。**改动折扣逻辑必须同时改这两处**，否则会出现预览金额与最终结算不一致。
-- ============================================================

-- ── 1. member_rewards ────────────────────────────────────────────────────────
-- 一条记录 = 一张已经解锁的奖励。券类奖励（£2 / £5）在解锁时同步生成内部券，
-- 券码不向顾客展示，只作为结算台核销的凭据。

CREATE TABLE IF NOT EXISTS member_rewards (
  reward_id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id              uuid        NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  reward_type            text        NOT NULL,
  cycle_index            integer     NOT NULL,
  unlocked_at            timestamptz NOT NULL DEFAULT NOW(),
  unlocked_by_session_id text        REFERENCES timer_sessions(session_id) ON DELETE SET NULL,
  coupon_id              uuid        REFERENCES coupons(coupon_id) ON DELETE RESTRICT,
  used_at                timestamptz,
  used_by                text,
  used_session_id        text        REFERENCES timer_sessions(session_id) ON DELETE RESTRICT
);

ALTER TABLE member_rewards DROP CONSTRAINT IF EXISTS member_rewards_type_check;
ALTER TABLE member_rewards ADD CONSTRAINT member_rewards_type_check
  CHECK (reward_type IN ('TWO_POUND', 'FIVE_POUND', 'PERSONAL_15_OFF', 'FRIEND_10_OFF', 'VIP_MONTH'));

-- 轮次从 1 开始（判定式 10 ×(轮次 - 1) + 档位，见 PRD 7）
ALTER TABLE member_rewards DROP CONSTRAINT IF EXISTS member_rewards_cycle_check;
ALTER TABLE member_rewards ADD CONSTRAINT member_rewards_cycle_check
  CHECK (cycle_index >= 1);

-- 核销字段要么全空，要么成组出现（与 coupons 的处理一致）
ALTER TABLE member_rewards DROP CONSTRAINT IF EXISTS member_rewards_used_check;
ALTER TABLE member_rewards ADD CONSTRAINT member_rewards_used_check
  CHECK (
    (used_at IS NULL     AND used_by IS NULL     AND used_session_id IS NULL)
    OR
    (used_at IS NOT NULL AND used_by IS NOT NULL AND used_session_id IS NOT NULL)
  );

-- coupon_id 的含义按奖励类型区分（PRD 19.4）：
--   TWO_POUND / FIVE_POUND  ：解锁时由系统生成的内部券，必定存在
--   PERSONAL_15_OFF / VIP_MONTH：不可转赠，不允许挂券
--   FRIEND_10_OFF           ：空 = 仍可直接用于朋友；非空 = 已转赠为普通券，不能再直接使用
ALTER TABLE member_rewards DROP CONSTRAINT IF EXISTS member_rewards_coupon_check;
ALTER TABLE member_rewards ADD CONSTRAINT member_rewards_coupon_check
  CHECK (
    (reward_type IN ('PERSONAL_15_OFF', 'VIP_MONTH') AND coupon_id IS NULL)
    OR (reward_type IN ('TWO_POUND', 'FIVE_POUND') AND coupon_id IS NOT NULL)
    OR reward_type = 'FRIEND_10_OFF'
  );

-- 已转赠成券的 Friend Reward 不允许再被会员通道直接核销（PRD 10.4）
ALTER TABLE member_rewards DROP CONSTRAINT IF EXISTS member_rewards_friend_transfer_check;
ALTER TABLE member_rewards ADD CONSTRAINT member_rewards_friend_transfer_check
  CHECK (NOT (reward_type = 'FRIEND_10_OFF' AND coupon_id IS NOT NULL AND used_at IS NOT NULL));

-- 解锁幂等：同一会员同一轮同一档位只可能有一条
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_rewards_idempotent
  ON member_rewards(member_id, reward_type, cycle_index);

-- 结算台挑券：按会员 + 类型找「最早解锁且未使用」的一张
CREATE INDEX IF NOT EXISTS idx_member_rewards_available
  ON member_rewards(member_id, reward_type, used_at);

-- 撤销结算要能反查「这一单解锁了哪些奖励」「这一单用了哪张奖励」
CREATE INDEX IF NOT EXISTS idx_member_rewards_unlocked_by
  ON member_rewards(unlocked_by_session_id) WHERE unlocked_by_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_member_rewards_used_session
  ON member_rewards(used_session_id) WHERE used_session_id IS NOT NULL;

-- RLS：照 014 / 016 的处理，只启用、不建策略，应用全走 service role
ALTER TABLE member_rewards ENABLE ROW LEVEL SECURITY;

-- ── 2. member_benefits（VIP Month）───────────────────────────────────────────
-- 一个会员可以累计多张 VIP Month，但同一时间最多一张生效（PRD 11.6）。
-- activated_on 为空 = 已解锁、尚未激活；到期与否由日期派生，不存状态字段。

CREATE TABLE IF NOT EXISTS member_benefits (
  benefit_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid        NOT NULL REFERENCES members(member_id) ON DELETE CASCADE,
  reward_id    uuid        NOT NULL REFERENCES member_rewards(reward_id) ON DELETE CASCADE,
  activated_on date,
  activated_at timestamptz,
  expires_on   date,
  activated_by text
);

-- 一个 VIP 奖励只对应一条权益记录
CREATE UNIQUE INDEX IF NOT EXISTS idx_member_benefits_reward
  ON member_benefits(reward_id);

-- 有效期 30 天含首尾：expires_on = activated_on + 29（PRD 11.2）
ALTER TABLE member_benefits DROP CONSTRAINT IF EXISTS member_benefits_expiry_check;
ALTER TABLE member_benefits ADD CONSTRAINT member_benefits_expiry_check
  CHECK (activated_on IS NULL OR expires_on = activated_on + 29);

-- 激活字段要么全空，要么成组出现
ALTER TABLE member_benefits DROP CONSTRAINT IF EXISTS member_benefits_activation_check;
ALTER TABLE member_benefits ADD CONSTRAINT member_benefits_activation_check
  CHECK (
    (activated_on IS NULL AND activated_at IS NULL AND expires_on IS NULL AND activated_by IS NULL)
    OR
    (activated_on IS NOT NULL AND activated_at IS NOT NULL AND expires_on IS NOT NULL AND activated_by IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_member_benefits_member ON member_benefits(member_id, activated_on);

ALTER TABLE member_benefits ENABLE ROW LEVEL SECURITY;

-- ── 3. 口径函数与视图 ────────────────────────────────────────────────────────

-- VIP 是否在某个时刻生效。伦敦自然日、含首尾（PRD 11.2）。
-- 结算、会员页、后台都走这一个定义，避免三处各写一份日期判断。
CREATE OR REPLACE FUNCTION public.member_vip_active(
  p_member_id uuid,
  p_at        timestamptz DEFAULT NOW()
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM member_benefits b
     WHERE b.member_id = p_member_id
       AND b.activated_on IS NOT NULL
       AND (p_at AT TIME ZONE 'Europe/London')::date BETWEEN b.activated_on AND b.expires_on
  );
$$;

-- Visit 口径（PRD 20）：
--   Lifetime Visits = 本视图行数
--   Reward Progress = 本视图 reward_eligible 为真的行数
-- 同一会员同一天的多条已结算订单合并成一行；当天只要有一条订单被判定计入进度，
-- 这一天就算进度的（VIP 激活当天早些时候完成的消费因此不会被误伤）。
DROP VIEW IF EXISTS public.member_visit_days;
CREATE VIEW public.member_visit_days
WITH (security_invoker = true) AS
SELECT
  member_id,
  (started_at AT TIME ZONE 'Europe/London')::date AS visit_date,
  bool_or(COALESCE(reward_eligible, false))       AS reward_eligible
FROM timer_sessions
WHERE member_id IS NOT NULL
  AND is_settled
GROUP BY 1, 2;

REVOKE ALL ON public.member_visit_days FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.member_visit_days FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON public.member_visit_days FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT ON public.member_visit_days TO service_role';
  END IF;
END $$;

-- ── 4. 解锁奖励（幂等）───────────────────────────────────────────────────────
-- 按当前 Reward Progress 把所有该解锁的奖励补齐，已存在的跳过。
-- 第 2 轮及以后靠「10 ×(轮次 - 1) + 档位」自动落在 12 / 15 / 18 / 20（PRD 7）。
-- VIP Month 解锁即建一条未激活的权益记录，不自动激活（PRD 11.1）。

CREATE OR REPLACE FUNCTION public.ensure_member_rewards(
  p_member_id  uuid,
  p_session_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_progress    integer;
  v_cycle       integer;
  v_node        integer;
  v_reward_type text;
  v_reward_id   uuid;
  v_inserted    uuid;
  v_coupon_id   uuid;
  v_new         jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE member_id = p_member_id) THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_progress
    FROM member_visit_days
   WHERE member_id = p_member_id
     AND reward_eligible;

  IF v_progress > 0 THEN
    FOR v_cycle IN 1 .. ((v_progress - 1) / 10 + 1) LOOP
      FOR v_node, v_reward_type IN
        SELECT * FROM (VALUES
          (2,  'TWO_POUND'),
          (5,  'FIVE_POUND'),
          (8,  'PERSONAL_15_OFF'),
          (8,  'FRIEND_10_OFF'),
          (10, 'VIP_MONTH')
        ) AS t(node, reward_type)
      LOOP
        CONTINUE WHEN v_progress < 10 * (v_cycle - 1) + v_node;

        -- reward_id 先生成：券码由它派生，而奖励行的 CHECK 要求券类奖励必须带 coupon_id，
        -- 所以券要在插入奖励行之前铸好。
        v_reward_id := gen_random_uuid();
        v_coupon_id := NULL;

        IF v_reward_type IN ('TWO_POUND', 'FIVE_POUND') THEN
          -- 内部券：券码由 reward_id 派生，天然唯一，不需要随机数与重试。
          -- 顾客看不到这个码（PRD 9），它只是结算台核销的凭据。
          -- code_prefix 必须显式写：015 的 coupons_code_prefix_check 要求
          -- left(code, length(code_prefix)) = code_prefix，而该列默认值是 'TD'，
          -- 不写就会拿默认值去比 'MB' 开头的券码，直接被约束拒掉。
          -- 用 MB 前缀的另一个好处：活动报表（coupon_prefix_usage）里会员内部券
          -- 与店员手工发的 TD 券分开统计。
          INSERT INTO coupons (code, code_prefix, discount_type, discount_value, created_by)
          VALUES (
            'MB' || upper(substr(replace(v_reward_id::text, '-', ''), 1, 16)),
            'MB',
            'fixed_amount',
            CASE v_reward_type WHEN 'TWO_POUND' THEN 2.00 ELSE 5.00 END,
            'member_reward'
          )
          RETURNING coupon_id INTO v_coupon_id;
        END IF;

        v_inserted := NULL;
        INSERT INTO member_rewards (
          reward_id, member_id, reward_type, cycle_index, unlocked_by_session_id, coupon_id
        )
        VALUES (
          v_reward_id, p_member_id, v_reward_type, v_cycle, p_session_id, v_coupon_id
        )
        ON CONFLICT (member_id, reward_type, cycle_index) DO NOTHING
        RETURNING reward_id INTO v_inserted;

        -- 已存在（重复调用或并发）：幂等跳过，并撤掉刚铸的券，不留孤儿
        IF v_inserted IS NULL THEN
          IF v_coupon_id IS NOT NULL THEN
            DELETE FROM coupons WHERE coupon_id = v_coupon_id;
          END IF;
          CONTINUE;
        END IF;

        -- VIP Month：解锁即建权益记录，activated_on 留空表示未激活
        IF v_reward_type = 'VIP_MONTH' THEN
          INSERT INTO member_benefits (member_id, reward_id)
          VALUES (p_member_id, v_reward_id)
          ON CONFLICT (reward_id) DO NOTHING;
        END IF;

        v_new := v_new || jsonb_build_object('reward_type', v_reward_type, 'cycle_index', v_cycle);
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'member_id', p_member_id,
    'progress',  v_progress,
    'unlocked',  v_new
  );
END;
$$;

-- ── 5. 结算：接入会员折扣 ────────────────────────────────────────────────────
-- 旧的 5 参数版本必须删掉：新版本带默认值，留着两个会构成重载，
-- 调用 5 个参数时 PostgreSQL 无法判断用哪一个。删除后原调用方式照常工作。
DROP FUNCTION IF EXISTS public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER);

CREATE OR REPLACE FUNCTION public.settle_timer_session(
  p_session_id            TEXT,
  p_settled_by            TEXT,
  p_settlement_note       TEXT    DEFAULT NULL,
  p_coupon_code           TEXT    DEFAULT NULL,
  p_discount_amount_pence INTEGER DEFAULT NULL,
  p_discount_source       TEXT    DEFAULT 'none',
  p_member_id             UUID    DEFAULT NULL,
  p_reward_type           TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session         timer_sessions%ROWTYPE;
  v_coupon          coupons%ROWTYPE;
  v_reward          member_rewards%ROWTYPE;
  v_code            TEXT;
  v_source          TEXT;
  v_pre_pence       INTEGER;
  v_expect          INTEGER;
  v_final_pence     INTEGER;
  v_pct             NUMERIC;
  v_vip_active      BOOLEAN := false;
  v_reward_eligible BOOLEAN;
  v_reward_code     TEXT;
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

  -- 2. 折扣来源归一（PRD 21：一次结算只允许一个折扣来源）
  v_source := COALESCE(NULLIF(btrim(COALESCE(p_discount_source, '')), ''), 'none');
  IF v_source NOT IN ('none', 'coupon', 'member_reward', 'vip_month') THEN
    RAISE EXCEPTION 'DISCOUNT_SOURCE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- 传了券码就是券折扣（兼容旧调用方只传券码的写法）
  IF btrim(COALESCE(p_coupon_code, '')) <> '' AND v_source = 'none' THEN
    v_source := 'coupon';
  END IF;
  IF v_source = 'coupon' AND btrim(COALESCE(p_coupon_code, '')) = '' THEN
    RAISE EXCEPTION 'COUPON_CODE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF v_source <> 'coupon' AND btrim(COALESCE(p_coupon_code, '')) <> '' THEN
    RAISE EXCEPTION 'MULTIPLE_DISCOUNT_SOURCES' USING ERRCODE = 'P0001';
  END IF;

  -- 3. VIP 生效期间强制走 VIP 折扣（PRD 11.4 / 21）。
  --    这里故意抛错而不是静默改写：TypeScript 侧的预览必须同步改，否则预览金额与最终结算会不一致。
  IF v_session.member_id IS NOT NULL THEN
    v_vip_active := member_vip_active(v_session.member_id);
  END IF;
  IF v_vip_active AND v_source <> 'vip_month' THEN
    RAISE EXCEPTION 'VIP_MUST_BE_APPLIED' USING ERRCODE = 'P0001';
  END IF;

  -- 4. 按来源计算并复核折扣金额
  IF v_source = 'none' THEN
    v_expect := 0;

  ELSIF v_source = 'coupon' THEN
    v_code := upper(btrim(p_coupon_code));
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

    IF p_discount_amount_pence IS NULL THEN
      RAISE EXCEPTION 'COUPON_DISCOUNT_MISSING' USING ERRCODE = 'P0001';
    END IF;

    IF v_coupon.discount_type = 'fixed_amount' THEN
      v_expect := LEAST(ROUND(v_coupon.discount_value * 100)::INTEGER, v_pre_pence);
    ELSIF v_coupon.discount_type = 'percentage_off' THEN
      v_expect := ROUND(v_pre_pence * v_coupon.discount_value / 100)::INTEGER;
    ELSE  -- time_minutes：首小时不可减免，优惠金额由服务端按定价常量计算
      IF v_session.billing_minutes IS NULL OR v_session.billing_minutes <= 60 THEN
        RAISE EXCEPTION 'COUPON_TIME_NOT_APPLICABLE' USING ERRCODE = 'P0001';
      END IF;
      v_expect := p_discount_amount_pence;
    END IF;

    IF p_discount_amount_pence <> v_expect THEN
      RAISE EXCEPTION 'COUPON_DISCOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

  ELSIF v_source = 'member_reward' THEN
    IF p_member_id IS NULL THEN
      RAISE EXCEPTION 'MEMBER_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF p_reward_type IS NULL OR p_reward_type NOT IN ('TWO_POUND', 'FIVE_POUND', 'PERSONAL_15_OFF', 'FRIEND_10_OFF') THEN
      RAISE EXCEPTION 'REWARD_TYPE_INVALID' USING ERRCODE = 'P0001';
    END IF;

    -- 除朋友券外，订单必须属于该会员本人（PRD 10.1；忘了以会员身份计时的先用后台 Link to Member）
    IF p_reward_type <> 'FRIEND_10_OFF'
       AND v_session.member_id IS DISTINCT FROM p_member_id THEN
      RAISE EXCEPTION 'MEMBER_SESSION_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    -- 挑「最早解锁且未使用」的一张同类奖励（PRD 9）。
    -- 排除本单自己解锁出来的那张，保证刚解锁的奖励不能用于产生它的这笔消费（PRD 8）。
    SELECT * INTO v_reward
      FROM member_rewards
     WHERE member_id = p_member_id
       AND reward_type = p_reward_type
       AND used_at IS NULL
       AND (reward_type <> 'FRIEND_10_OFF' OR coupon_id IS NULL)   -- 已转赠成券的不能再直接使用
       AND (unlocked_by_session_id IS NULL OR unlocked_by_session_id <> p_session_id)
     ORDER BY unlocked_at, reward_id
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MEMBER_REWARD_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    IF p_discount_amount_pence IS NULL THEN
      RAISE EXCEPTION 'MEMBER_DISCOUNT_MISSING' USING ERRCODE = 'P0001';
    END IF;

    IF p_reward_type = 'TWO_POUND' THEN
      v_expect := LEAST(200, v_pre_pence);
    ELSIF p_reward_type = 'FIVE_POUND' THEN
      v_expect := LEAST(500, v_pre_pence);
    ELSIF p_reward_type = 'PERSONAL_15_OFF' THEN
      v_expect := ROUND(v_pre_pence * 15::numeric / 100)::INTEGER;
    ELSE  -- FRIEND_10_OFF
      v_expect := ROUND(v_pre_pence * 10::numeric / 100)::INTEGER;
    END IF;

    IF p_discount_amount_pence <> v_expect THEN
      RAISE EXCEPTION 'MEMBER_DISCOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

  ELSE  -- vip_month
    IF v_session.member_id IS NULL THEN
      RAISE EXCEPTION 'MEMBER_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
    IF p_member_id IS NOT NULL AND p_member_id <> v_session.member_id THEN
      RAISE EXCEPTION 'MEMBER_SESSION_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_vip_active THEN
      RAISE EXCEPTION 'VIP_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;

    IF p_discount_amount_pence IS NULL THEN
      RAISE EXCEPTION 'MEMBER_DISCOUNT_MISSING' USING ERRCODE = 'P0001';
    END IF;

    v_expect := ROUND(v_pre_pence * 15::numeric / 100)::INTEGER;
    IF p_discount_amount_pence <> v_expect THEN
      RAISE EXCEPTION 'MEMBER_DISCOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_final_pence := v_pre_pence - v_expect;
  IF v_expect < 0 OR v_final_pence < 0 THEN
    RAISE EXCEPTION 'DISCOUNT_AMOUNT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- 5. 固化本次消费是否计入 Reward Progress（PRD 19.2）。
  --    散客单不判定，留 NULL；会员单在结算这一刻看有没有生效中的 VIP。
  IF v_session.member_id IS NULL THEN
    v_reward_eligible := NULL;
  ELSE
    v_reward_eligible := NOT v_vip_active;
  END IF;

  -- 会员券类奖励的内部券码，仅作快照留痕，顾客端不展示
  IF v_source = 'member_reward' AND v_reward.coupon_id IS NOT NULL THEN
    SELECT code INTO v_reward_code FROM coupons WHERE coupon_id = v_reward.coupon_id;
  END IF;

  -- 6. 写结算（折扣快照列沿用 013 的字段：会员券落在 coupon_id，VIP 折扣不带券）
  UPDATE timer_sessions SET
    is_settled                 = TRUE,
    actual_amount_gbp          = ROUND(v_final_pence / 100.0, 2),
    settlement_note            = p_settlement_note,
    settled_at                 = NOW(),
    settled_by                 = p_settled_by,
    reward_eligible            = v_reward_eligible,
    coupon_id                  = CASE WHEN v_source = 'coupon'        THEN v_coupon.coupon_id
                                     WHEN v_source = 'member_reward' THEN v_reward.coupon_id
                                     ELSE NULL END,
    coupon_code_snapshot       = CASE WHEN v_source = 'coupon'        THEN v_coupon.code
                                     WHEN v_source = 'member_reward' THEN v_reward_code
                                     ELSE NULL END,
    discount_type_snapshot     = CASE v_source
                                   WHEN 'coupon'        THEN v_coupon.discount_type
                                   WHEN 'member_reward' THEN CASE v_reward.reward_type
                                                              WHEN 'TWO_POUND'       THEN 'fixed_amount'
                                                              WHEN 'FIVE_POUND'      THEN 'fixed_amount'
                                                              ELSE 'percentage_off'
                                                            END
                                   WHEN 'vip_month'     THEN 'percentage_off'
                                   ELSE NULL
                                 END,
    discount_value_snapshot    = CASE v_source
                                   WHEN 'coupon'        THEN v_coupon.discount_value
                                   WHEN 'member_reward' THEN CASE v_reward.reward_type
                                                              WHEN 'TWO_POUND'       THEN 2.00
                                                              WHEN 'FIVE_POUND'      THEN 5.00
                                                              WHEN 'PERSONAL_15_OFF' THEN 15.00
                                                              ELSE 10.00
                                                            END
                                   WHEN 'vip_month'     THEN 15.00
                                   ELSE NULL
                                 END,
    discount_amount_gbp        = ROUND(v_expect / 100.0, 2),
    pre_discount_amount_gbp    = v_session.amount_gbp,
    discounted_billing_minutes = NULL
  WHERE session_id = p_session_id
  RETURNING * INTO v_session;

  -- 7. 核销：普通券，或会员奖励（券类奖励同时核销它自己的内部券）
  IF v_source = 'coupon' THEN
    UPDATE coupons SET
      redeemed_at         = NOW(),
      redeemed_by         = p_settled_by,
      redeemed_session_id = p_session_id
    WHERE coupon_id = v_coupon.coupon_id;

  ELSIF v_source = 'member_reward' THEN
    UPDATE member_rewards SET
      used_at         = NOW(),
      used_by         = p_settled_by,
      used_session_id = p_session_id
    WHERE reward_id = v_reward.reward_id;

    IF v_reward.coupon_id IS NOT NULL THEN
      UPDATE coupons SET
        redeemed_at         = NOW(),
        redeemed_by         = p_settled_by,
        redeemed_session_id = p_session_id
      WHERE coupon_id = v_reward.coupon_id
        AND redeemed_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'MEMBER_REWARD_COUPON_USED' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- 8. 结算落库之后才解锁新奖励：本单用不到刚解锁出来的奖励（PRD 8）
  IF v_session.member_id IS NOT NULL THEN
    PERFORM ensure_member_rewards(v_session.member_id, p_session_id);
  END IF;

  RETURN to_jsonb(v_session);
END;
$$;

-- ── 6. 撤销结算：会员奖励与 VIP 的回退 ───────────────────────────────────────
-- 全部检查放在动手之前，避免半途报错留下半截状态（PRD 18）。

CREATE OR REPLACE FUNCTION public.unsettle_timer_session(
  p_session_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session     timer_sessions%ROWTYPE;
  v_coupon      coupons%ROWTYPE;
  v_blocked     INTEGER;
  v_coupon_ids  uuid[];
  v_vip_started INTEGER;
BEGIN
  SELECT * INTO v_session FROM timer_sessions WHERE session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT v_session.is_settled THEN
    RAISE EXCEPTION 'SESSION_NOT_SETTLED' USING ERRCODE = 'P0001';
  END IF;

  -- 6.1 本单解锁出来的奖励，只要有一张已经被用掉（或被转赠成券），普通店员撤不了
  SELECT count(*) INTO v_blocked
    FROM member_rewards
   WHERE unlocked_by_session_id = p_session_id
     AND (
       used_at IS NOT NULL
       OR (reward_type = 'FRIEND_10_OFF' AND coupon_id IS NOT NULL)
       OR EXISTS (
         SELECT 1 FROM coupons c
          WHERE c.coupon_id = member_rewards.coupon_id
            AND c.redeemed_at IS NOT NULL
       )
     );
  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'REWARD_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;

  -- 6.2 本单解锁的 VIP Month 已经激活过，撤不掉（权益已经消耗在时间上）
  SELECT count(*) INTO v_vip_started
    FROM member_benefits b
    JOIN member_rewards r ON r.reward_id = b.reward_id
   WHERE r.unlocked_by_session_id = p_session_id
     AND b.activated_on IS NOT NULL;
  IF v_vip_started > 0 THEN
    RAISE EXCEPTION 'VIP_ALREADY_ACTIVATED' USING ERRCODE = 'P0001';
  END IF;

  -- 6.3 恢复该单核销掉的普通券（仅当该券确实由本单核销）
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

  -- 6.4 本单消费掉的会员奖励退回未使用（PRD 24 验收项）
  UPDATE member_rewards SET
    used_at         = NULL,
    used_by         = NULL,
    used_session_id = NULL
  WHERE used_session_id = p_session_id;

  -- 6.5 回退本单解锁出来的奖励。
  --      顺序不能反：member_rewards.coupon_id 指向 coupons 且是 ON DELETE RESTRICT，
  --      必须先删奖励行，再删它名下的内部券，否则外键会把整次撤销拦下。
  SELECT COALESCE(array_agg(coupon_id), '{}'::uuid[]) INTO v_coupon_ids
    FROM member_rewards
   WHERE unlocked_by_session_id = p_session_id
     AND coupon_id IS NOT NULL
     AND used_at IS NULL;

  DELETE FROM member_benefits
   WHERE reward_id IN (
     SELECT reward_id FROM member_rewards WHERE unlocked_by_session_id = p_session_id
   );

  DELETE FROM member_rewards
   WHERE unlocked_by_session_id = p_session_id
     AND used_at IS NULL;

  DELETE FROM coupons
   WHERE coupon_id = ANY(v_coupon_ids)
     AND redeemed_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM timer_sessions t WHERE t.coupon_id = coupons.coupon_id
     );

  -- 6.6 清空结算字段与进度资格
  UPDATE timer_sessions SET
    is_settled                 = FALSE,
    actual_amount_gbp          = NULL,
    actual_amount_cny          = NULL,
    settlement_note            = NULL,
    settled_at                 = NULL,
    settled_by                 = NULL,
    reward_eligible            = NULL,
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

-- ── 7. 后台动作：把订单关联到会员、激活 VIP Month ────────────────────────────

-- 顾客以散客身份开始计时后才想起自己是会员时，店员在后台把订单挂到会员名下（PRD 5.2）。
-- 只允许挂「尚未结算」的单：进度必须来自真实结算记录，已结算的单要先撤销结算再挂，
-- 否则等于绕过结算台账手动改数字（PRD 16.3、18）。
CREATE OR REPLACE FUNCTION public.link_timer_session_to_member(
  p_session_id text,
  p_member_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session timer_sessions%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM members WHERE member_id = p_member_id AND is_active) THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_session FROM timer_sessions WHERE session_id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_session.is_settled THEN
    RAISE EXCEPTION 'SESSION_ALREADY_SETTLED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE timer_sessions SET
    member_id       = p_member_id,
    reward_eligible = NULL          -- 结算时才判定，避免留下未经验证的进度资格
  WHERE session_id = p_session_id
  RETURNING * INTO v_session;

  RETURN to_jsonb(v_session);
END;
$$;

-- 激活一张 VIP Month（会员自己点或店员代点，PRD 11.1）。
-- 同一时间最多一张生效，且到期后不自动续（PRD 11.6）：靠锁住该会员全部权益行来串行化。
CREATE OR REPLACE FUNCTION public.activate_member_vip(
  p_reward_id    uuid,
  p_activated_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward  member_rewards%ROWTYPE;
  v_benefit member_benefits%ROWTYPE;
  v_today   date;
BEGIN
  v_today := (NOW() AT TIME ZONE 'Europe/London')::date;

  SELECT * INTO v_reward FROM member_rewards WHERE reward_id = p_reward_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_REWARD_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_reward.reward_type <> 'VIP_MONTH' THEN
    RAISE EXCEPTION 'REWARD_TYPE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_benefit FROM member_benefits WHERE reward_id = p_reward_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_BENEFIT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_benefit.activated_on IS NOT NULL THEN
    RAISE EXCEPTION 'VIP_ALREADY_ACTIVATED' USING ERRCODE = 'P0001';
  END IF;

  -- 先锁住该会员的全部权益行，再把「有没有生效中的」判断与写入放进同一个事务
  PERFORM 1 FROM member_benefits WHERE member_id = v_reward.member_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM member_benefits b
     WHERE b.member_id = v_reward.member_id
       AND b.activated_on IS NOT NULL
       AND v_today BETWEEN b.activated_on AND b.expires_on
  ) THEN
    RAISE EXCEPTION 'VIP_ALREADY_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  UPDATE member_benefits SET
    activated_on = v_today,
    activated_at = NOW(),
    expires_on   = v_today + 29,      -- 30 天含首尾（PRD 11.2）
    activated_by = p_activated_by
  WHERE benefit_id = v_benefit.benefit_id
  RETURNING * INTO v_benefit;

  RETURN to_jsonb(v_benefit);
END;
$$;

-- ── 8. 权限：仅 service role 可执行 ──────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT) TO service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.unsettle_timer_session(TEXT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.unsettle_timer_session(TEXT) TO service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_member_rewards(UUID, TEXT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_member_rewards(UUID, TEXT) TO service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.member_vip_active(UUID, TIMESTAMPTZ) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.member_vip_active(UUID, TIMESTAMPTZ) TO service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.link_timer_session_to_member(TEXT, UUID) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.link_timer_session_to_member(TEXT, UUID) TO service_role';
    EXECUTE 'REVOKE ALL ON FUNCTION public.activate_member_vip(UUID, TEXT) FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.activate_member_vip(UUID, TEXT) TO service_role';
  END IF;
END $$;

-- ============================================================
-- ROLLBACK：
--   先恢复 013 版本的 settle_timer_session（无会员参数），再执行下面这些。
--   DROP FUNCTION IF EXISTS public.settle_timer_session(TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.ensure_member_rewards(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.link_timer_session_to_member(TEXT, UUID);
--   DROP FUNCTION IF EXISTS public.activate_member_vip(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.member_vip_active(UUID, TIMESTAMPTZ);
--   DROP VIEW  IF EXISTS public.member_visit_days;
--   DROP TABLE IF EXISTS member_benefits;
--   DROP TABLE IF EXISTS member_rewards;
--   ALTER TABLE timer_sessions DROP COLUMN IF EXISTS reward_eligible;   -- 见 016
--   注意：回滚不会恢复已被 017 删除的历史奖励记录。
-- ============================================================
