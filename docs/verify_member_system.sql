-- ============================================================
-- 会员系统验收检查（PRD 24 里能在数据库层验证的部分）
--
-- 全部在一个事务里跑，最后 ROLLBACK：测试库里不会留下任何测试数据。
-- 结果写进临时表 chk，脚本最后 SELECT 出来。
-- ============================================================

BEGIN;

CREATE TEMP TABLE chk (
  编号   serial,
  检查项 text,
  期望   text,
  实际   text,
  结果   text
) ON COMMIT DROP;

DO $verify$
DECLARE
  v_today    date := (NOW() AT TIME ZONE 'Europe/London')::date;
  v_a        uuid;   -- 进度 12 的会员
  v_b        uuid;   -- 进度 1 的会员，用来测「刚解锁的奖励」与撤销守卫
  v_s        text;
  v_s2       text;
  v_vip_c1   uuid;
  v_vip_c2   uuid;
  v_benefit  uuid;
  v_coupon   uuid;
  v_cnt      integer;
  v_num      numeric;
  v_txt      text;
  v_bool     boolean;
BEGIN
  ------------------------------------------------------------------
  -- 0. 结构
  ------------------------------------------------------------------
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('members 表存在', 'true',
     (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='members'))::text,
     CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='members') THEN 'PASS' ELSE 'FAIL' END),
    ('member_rewards 表存在', 'true',
     (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='member_rewards'))::text,
     CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='member_rewards') THEN 'PASS' ELSE 'FAIL' END),
    ('member_benefits 表存在', 'true',
     (EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='member_benefits'))::text,
     CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='member_benefits') THEN 'PASS' ELSE 'FAIL' END),
    ('member_visit_days 视图存在', 'true',
     (EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='member_visit_days'))::text,
     CASE WHEN EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='member_visit_days') THEN 'PASS' ELSE 'FAIL' END),
    ('settle 函数已是 8 参数版', '8',
     (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='settle_timer_session' AND p.pronargs=8),
     CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname='public' AND p.proname='settle_timer_session' AND p.pronargs=8) = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- timer_sessions 的列
  INSERT INTO chk (检查项, 期望, 实际, 结果)
  SELECT 'timer_sessions.member_id 列存在', 'true', count(*)::text,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='timer_sessions' AND column_name='member_id';

  INSERT INTO chk (检查项, 期望, 实际, 结果)
  SELECT 'timer_sessions.reward_eligible 列存在', 'true', count(*)::text,
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='timer_sessions' AND column_name='reward_eligible';

  INSERT INTO chk (检查项, 期望, 实际, 结果)
  SELECT 'bookings 没有 member_id 列（本次收窄）', '0', count(*)::text,
         CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bookings' AND column_name='member_id';

  ------------------------------------------------------------------
  -- 1. 造会员 A：12 个不同伦敦日期的已结算、计入进度的到店
  ------------------------------------------------------------------
  INSERT INTO members (email, email_key, display_name, consent_source)
  VALUES ('hermes.a@example.com', 'hermes.a@example.com', '甲', 'in_store')
  RETURNING member_id INTO v_a;

  INSERT INTO members (email, email_key, display_name, consent_source)
  VALUES ('hermes.b@example.com', 'hermes.b@example.com', '乙', 'booking')
  RETURNING member_id INTO v_b;

  FOR v_cnt IN 1..12 LOOP
    INSERT INTO timer_sessions (
      session_id, customer_name, status, started_at, is_settled, settled_at, settled_by,
      billing_minutes, amount_gbp, actual_amount_gbp, created_via, created_by,
      member_id, reward_eligible
    ) VALUES (
      'HT-A-' || lpad(v_cnt::text, 3, '0'), '甲', 'completed',
      ((v_today - 200 + v_cnt)::timestamp + interval '12 hours') AT TIME ZONE 'Europe/London',
      true, NOW(), 'hermes_test', 60, 13.99, 13.99, 'self_service', 'hermes_test',
      v_a, true
    );
  END LOOP;

  SELECT count(*) INTO v_cnt FROM member_visit_days WHERE member_id = v_a;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('12 个不同日期 = 12 次到店', '12', v_cnt::text, CASE WHEN v_cnt = 12 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt FROM member_visit_days WHERE member_id = v_a AND reward_eligible;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('Reward Progress 也是 12', '12', v_cnt::text, CASE WHEN v_cnt = 12 THEN 'PASS' ELSE 'FAIL' END);

  -- 同一会员同一天再来一条已结算单：只算 1 次
  INSERT INTO timer_sessions (
    session_id, customer_name, status, started_at, is_settled, settled_at, settled_by,
    billing_minutes, amount_gbp, actual_amount_gbp, created_via, created_by, member_id, reward_eligible
  ) VALUES (
    'HT-A-DUP', '甲', 'completed',
    ((v_today - 199)::timestamp + interval '18 hours') AT TIME ZONE 'Europe/London',
    true, NOW(), 'hermes_test', 60, 13.99, 13.99, 'self_service', 'hermes_test', v_a, true
  );

  SELECT count(*) INTO v_cnt FROM member_visit_days WHERE member_id = v_a;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('同一天多条已结算单只算 1 次', '12', v_cnt::text, CASE WHEN v_cnt = 12 THEN 'PASS' ELSE 'FAIL' END);

  ------------------------------------------------------------------
  -- 2. 解锁：12 次进度 → 第一轮 5 张 + 第二轮 £2
  ------------------------------------------------------------------
  PERFORM ensure_member_rewards(v_a, NULL);

  SELECT count(*) INTO v_cnt FROM member_rewards WHERE member_id = v_a;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('12 次进度解锁 6 张（第一轮 5 + 第二轮 £2）', '6', v_cnt::text,
     CASE WHEN v_cnt = 6 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt
    FROM (VALUES (1,'TWO_POUND'),(1,'FIVE_POUND'),(1,'PERSONAL_15_OFF'),(1,'FRIEND_10_OFF'),(1,'VIP_MONTH'),(2,'TWO_POUND')) AS e(cycle_index, reward_type)
    JOIN member_rewards r ON r.member_id = v_a AND r.cycle_index = e.cycle_index AND r.reward_type = e.reward_type;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('档位与轮次都对（含第二轮 £2）', '6', v_cnt::text, CASE WHEN v_cnt = 6 THEN 'PASS' ELSE 'FAIL' END);

  PERFORM ensure_member_rewards(v_a, NULL);
  SELECT count(*) INTO v_cnt FROM member_rewards WHERE member_id = v_a;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('重复调用不会多发（幂等）', '6', v_cnt::text, CASE WHEN v_cnt = 6 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt FROM member_benefits WHERE member_id = v_a;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('VIP Month 解锁即建一条未激活权益', '1', v_cnt::text, CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt FROM member_benefits WHERE member_id = v_a AND activated_on IS NOT NULL;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('VIP Month 不自动激活', '0', v_cnt::text, CASE WHEN v_cnt = 0 THEN 'PASS' ELSE 'FAIL' END);

  -- 券类奖励解锁时是否自动生成了内部券
  SELECT count(*) INTO v_cnt
    FROM member_rewards r JOIN coupons c ON c.coupon_id = r.coupon_id
   WHERE r.member_id = v_a AND r.reward_type IN ('TWO_POUND','FIVE_POUND');
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('£2/£5 解锁时自动生成内部券', '3', v_cnt::text, CASE WHEN v_cnt = 3 THEN 'PASS' ELSE 'FAIL' END);

  ------------------------------------------------------------------
  -- 3. VIP 激活与日期边界
  ------------------------------------------------------------------
  SELECT reward_id INTO v_vip_c1 FROM member_rewards
   WHERE member_id = v_a AND reward_type = 'VIP_MONTH' AND cycle_index = 1;
  SELECT benefit_id INTO v_benefit FROM member_benefits WHERE reward_id = v_vip_c1;

  PERFORM activate_member_vip(v_vip_c1, 'hermes_test');

  SELECT expires_on INTO v_txt FROM member_benefits WHERE benefit_id = v_benefit;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('激活后到期日 = 今天 + 29 天', (v_today + 29)::text, v_txt,
     CASE WHEN v_txt = (v_today + 29)::text THEN 'PASS' ELSE 'FAIL' END);

  SELECT member_vip_active(v_a, NOW()) INTO v_bool;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('激活当天已生效', 'true', v_bool::text, CASE WHEN v_bool THEN 'PASS' ELSE 'FAIL' END);

  SELECT member_vip_active(v_a, ((v_today + 29)::timestamp + interval '12 hours') AT TIME ZONE 'Europe/London') INTO v_bool;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('到期日当天仍有效', 'true', v_bool::text, CASE WHEN v_bool THEN 'PASS' ELSE 'FAIL' END);

  SELECT member_vip_active(v_a, ((v_today + 30)::timestamp + interval '12 hours') AT TIME ZONE 'Europe/London') INTO v_bool;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('到期次日失效', 'false', v_bool::text, CASE WHEN NOT v_bool THEN 'PASS' ELSE 'FAIL' END);

  SELECT member_vip_active(v_a, ((v_today - 1)::timestamp + interval '12 hours') AT TIME ZONE 'Europe/London') INTO v_bool;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('激活前一天不算生效', 'false', v_bool::text, CASE WHEN NOT v_bool THEN 'PASS' ELSE 'FAIL' END);

  -- 已有生效中的一张时，不允许再激活第二张
  INSERT INTO member_rewards (member_id, reward_type, cycle_index)
  VALUES (v_a, 'VIP_MONTH', 2) RETURNING reward_id INTO v_vip_c2;
  INSERT INTO member_benefits (member_id, reward_id) VALUES (v_a, v_vip_c2);
  BEGIN
    PERFORM activate_member_vip(v_vip_c2, 'hermes_test');
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('已有生效中的 VIP 时拒绝激活第二张', 'VIP_ALREADY_ACTIVE', '居然成功了', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('已有生效中的 VIP 时拒绝激活第二张', 'VIP_ALREADY_ACTIVE', SQLERRM,
       CASE WHEN SQLERRM LIKE '%VIP_ALREADY_ACTIVE%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  ------------------------------------------------------------------
  -- 4. VIP 期间结算：自动 85 折、进度暂停、不能改用别的优惠
  ------------------------------------------------------------------
  INSERT INTO timer_sessions (
    session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id
  ) VALUES ('HT-VIP-1', '甲', 'completed', NOW() - interval '1 hour', false,
            60, 13.99, 'self_service', 'hermes_test', v_a)
  RETURNING session_id INTO v_s;

  PERFORM settle_timer_session(v_s, 'hermes_test', NULL, NULL, 210, 'vip_month', v_a, NULL);

  SELECT actual_amount_gbp INTO v_num FROM timer_sessions WHERE session_id = v_s;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('VIP 期间结算自动 85 折（13.99 → 11.89）', '11.89', v_num::text,
     CASE WHEN v_num = 11.89 THEN 'PASS' ELSE 'FAIL' END);

  SELECT reward_eligible INTO v_bool FROM timer_sessions WHERE session_id = v_s;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('VIP 期间的单不计入 Reward Progress', 'false', v_bool::text,
     CASE WHEN v_bool IS FALSE THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt FROM member_visit_days WHERE member_id = v_a;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('VIP 期间 Lifetime 照常加（12 → 13）', '13', v_cnt::text,
     CASE WHEN v_cnt = 13 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt FROM member_visit_days WHERE member_id = v_a AND reward_eligible;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('VIP 期间 Reward Progress 停住（仍为 12）', '12', v_cnt::text,
     CASE WHEN v_cnt = 12 THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id)
  VALUES ('HT-VIP-2', '甲', 'completed', NOW() - interval '30 minutes', false,
          60, 13.99, 'self_service', 'hermes_test', v_a)
  RETURNING session_id INTO v_s2;

  BEGIN
    PERFORM settle_timer_session(v_s2, 'hermes_test', NULL, NULL, 200, 'member_reward', v_a, 'TWO_POUND');
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('VIP 期间不能改用会员奖励', 'VIP_MUST_BE_APPLIED', '居然结算成功', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('VIP 期间不能改用会员奖励', 'VIP_MUST_BE_APPLIED', SQLERRM,
       CASE WHEN SQLERRM LIKE '%VIP_MUST_BE_APPLIED%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  INSERT INTO coupons (code, discount_type, discount_value, created_by)
  VALUES ('HTTEST0001', 'percentage_off', 10, 'hermes_test') RETURNING coupon_id INTO v_coupon;

  BEGIN
    PERFORM settle_timer_session(v_s2, 'hermes_test', NULL, 'HTTEST0001', 140, 'coupon', NULL, NULL);
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('VIP 期间普通优惠券也走强制 VIP（我们补的解释）', 'VIP_MUST_BE_APPLIED', '居然结算成功', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('VIP 期间普通优惠券也走强制 VIP（我们补的解释）', 'VIP_MUST_BE_APPLIED', SQLERRM,
       CASE WHEN SQLERRM LIKE '%VIP_MUST_BE_APPLIED%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- 让这张 VIP 过期，回到非 VIP 状态继续测别的
  UPDATE member_benefits
     SET activated_on = v_today - 40,
         activated_at = NOW(),
         expires_on   = v_today - 40 + 29,
         activated_by = 'hermes_test'
   WHERE benefit_id = v_benefit;

  SELECT member_vip_active(v_a, NOW()) INTO v_bool;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('把激活日改到 40 天前后 VIP 不再生效', 'false', v_bool::text,
     CASE WHEN NOT v_bool THEN 'PASS' ELSE 'FAIL' END);

  ------------------------------------------------------------------
  -- 5. £2 抵用券：结算、核销、撤销回退
  ------------------------------------------------------------------
  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id)
  VALUES ('HT-A-VCH', '甲', 'completed', NOW() - interval '20 minutes', false,
          60, 13.99, 'self_service', 'hermes_test', v_a)
  RETURNING session_id INTO v_s;

  PERFORM settle_timer_session(v_s, 'hermes_test', NULL, NULL, 200, 'member_reward', v_a, 'TWO_POUND');

  SELECT actual_amount_gbp INTO v_num FROM timer_sessions WHERE session_id = v_s;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('£2 抵用券结算（13.99 → 11.99）', '11.99', v_num::text,
     CASE WHEN v_num = 11.99 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt FROM member_rewards
   WHERE member_id = v_a AND reward_type = 'TWO_POUND' AND used_at IS NOT NULL;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('只核销了 1 张 £2（同类多张取最早）', '1', v_cnt::text,
     CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt
    FROM member_rewards r JOIN coupons c ON c.coupon_id = r.coupon_id
   WHERE r.member_id = v_a AND r.used_session_id = v_s AND c.redeemed_session_id = v_s;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('对应的内部券同步核销', '1', v_cnt::text, CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);

  PERFORM unsettle_timer_session(v_s);

  SELECT count(*) INTO v_cnt FROM member_rewards
   WHERE member_id = v_a AND used_session_id IS NULL AND used_at IS NULL
     AND reward_type = 'TWO_POUND' AND cycle_index = 1;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('撤销结算后 £2 退回未使用', '1', v_cnt::text, CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);

  SELECT count(*) INTO v_cnt
    FROM member_rewards r JOIN coupons c ON c.coupon_id = r.coupon_id
   WHERE r.member_id = v_a AND r.reward_type = 'TWO_POUND' AND r.cycle_index = 1
     AND c.redeemed_at IS NULL;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('撤销结算后内部券回到未核销', '1', v_cnt::text, CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);

  SELECT reward_eligible INTO v_txt FROM timer_sessions WHERE session_id = v_s;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('撤销结算后进度资格被清空', NULL::text, v_txt,
     CASE WHEN v_txt IS NULL THEN 'PASS' ELSE 'FAIL' END);

  ------------------------------------------------------------------
  -- 6. 朋友 9 折用在他人的订单上 / 本人券不能给他人
  ------------------------------------------------------------------
  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id)
  VALUES ('HT-GUEST-1', '散客', 'completed', NOW() - interval '15 minutes', false,
          60, 13.99, 'self_service', 'hermes_test', NULL)
  RETURNING session_id INTO v_s2;

  PERFORM settle_timer_session(v_s2, 'hermes_test', NULL, NULL, 140, 'member_reward', v_a, 'FRIEND_10_OFF');

  SELECT actual_amount_gbp INTO v_num FROM timer_sessions WHERE session_id = v_s2;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('朋友 9 折可用在他人订单上（13.99 → 12.59）', '12.59', v_num::text,
     CASE WHEN v_num = 12.59 THEN 'PASS' ELSE 'FAIL' END);

  SELECT reward_eligible INTO v_txt FROM timer_sessions WHERE session_id = v_s2;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('散客单不产生任何人的进度（reward_eligible 为 NULL）', NULL::text, v_txt,
     CASE WHEN v_txt IS NULL THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id)
  VALUES ('HT-GUEST-2', '散客二', 'completed', NOW() - interval '10 minutes', false,
          60, 13.99, 'self_service', 'hermes_test', NULL)
  RETURNING session_id INTO v_s;

  BEGIN
    PERFORM settle_timer_session(v_s, 'hermes_test', NULL, NULL, 210, 'member_reward', v_a, 'PERSONAL_15_OFF');
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('本人 85 折不能用在他人订单上', 'MEMBER_SESSION_MISMATCH', '居然结算成功', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('本人 85 折不能用在他人订单上', 'MEMBER_SESSION_MISMATCH', SQLERRM,
       CASE WHEN SQLERRM LIKE '%MEMBER_SESSION_MISMATCH%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  ------------------------------------------------------------------
  -- 7. 刚解锁的奖励不能用于产生它的那笔消费（PRD 8）
  ------------------------------------------------------------------
  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled, settled_at, settled_by,
    billing_minutes, amount_gbp, actual_amount_gbp, created_via, created_by, member_id, reward_eligible)
  VALUES ('HT-B-001', '乙', 'completed',
          ((v_today - 30)::timestamp + interval '12 hours') AT TIME ZONE 'Europe/London',
          true, NOW(), 'hermes_test', 60, 13.99, 13.99, 'self_service', 'hermes_test', v_b, true);

  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id)
  VALUES ('HT-B-002', '乙', 'completed', NOW() - interval '5 minutes', false,
          60, 13.99, 'self_service', 'hermes_test', v_b)
  RETURNING session_id INTO v_s;

  BEGIN
    PERFORM settle_timer_session(v_s, 'hermes_test', NULL, NULL, 200, 'member_reward', v_b, 'TWO_POUND');
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('刚解锁的奖励不能用于产生它的那笔消费', 'MEMBER_REWARD_UNAVAILABLE', '居然结算成功', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('刚解锁的奖励不能用于产生它的那笔消费', 'MEMBER_REWARD_UNAVAILABLE', SQLERRM,
       CASE WHEN SQLERRM LIKE '%MEMBER_REWARD_UNAVAILABLE%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  -- 这笔结算本身把 £2 解锁出来，并且没有被自己用掉
  PERFORM settle_timer_session(v_s, 'hermes_test', NULL, NULL, 0, 'none', NULL, NULL);

  SELECT count(*) INTO v_cnt FROM member_rewards
   WHERE member_id = v_b AND reward_type = 'TWO_POUND' AND cycle_index = 1
     AND unlocked_by_session_id = v_s AND used_at IS NULL;
  INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
    ('第 2 次到店解锁 £2 且未被本单使用', '1', v_cnt::text, CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);

  ------------------------------------------------------------------
  -- 8. 撤销守卫：奖励已被后续使用则不许撤销来源结算
  ------------------------------------------------------------------
  INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
    billing_minutes, amount_gbp, created_via, created_by, member_id)
  VALUES ('HT-B-003', '乙', 'completed', NOW() - interval '3 minutes', false,
          60, 13.99, 'self_service', 'hermes_test', v_b)
  RETURNING session_id INTO v_s2;

  PERFORM settle_timer_session(v_s2, 'hermes_test', NULL, NULL, 200, 'member_reward', v_b, 'TWO_POUND');

  BEGIN
    PERFORM unsettle_timer_session(v_s);
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('奖励已被后续使用则不许撤销来源结算', 'REWARD_ALREADY_USED', '居然撤销成功', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('奖励已被后续使用则不许撤销来源结算', 'REWARD_ALREADY_USED', SQLERRM,
       CASE WHEN SQLERRM LIKE '%REWARD_ALREADY_USED%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  ------------------------------------------------------------------
  -- 9. 约束守卫生效
  ------------------------------------------------------------------
  BEGIN
    INSERT INTO member_rewards (member_id, reward_type, cycle_index, coupon_id)
    VALUES (v_b, 'PERSONAL_15_OFF', 90, v_coupon);
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('不可转赠的奖励不能挂券', '被约束拦住', '居然插进去了', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('不可转赠的奖励不能挂券', '被约束拦住', SQLERRM,
       CASE WHEN SQLERRM LIKE '%member_rewards_coupon_check%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  BEGIN
    INSERT INTO timer_sessions (session_id, customer_name, status, started_at, is_settled,
      billing_minutes, amount_gbp, created_via, created_by, member_id, reward_eligible)
    VALUES ('HT-BAD-1', '散客', 'completed', NOW(), true, 60, 13.99, 'self_service', 'hermes_test', NULL, true);
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('散客单不能标为计入进度', '被约束拦住', '居然插进去了', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('散客单不能标为计入进度', '被约束拦住', SQLERRM,
       CASE WHEN SQLERRM LIKE '%timer_sessions_reward_eligible_check%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  BEGIN
    INSERT INTO member_rewards (member_id, reward_type, cycle_index, unlocked_at, coupon_id, used_at, used_by, used_session_id)
    VALUES (v_b, 'FRIEND_10_OFF', 91, NOW(), v_coupon, NOW(), 'hermes_test', 'HT-B-003');
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('已转赠的朋友券不能再直接核销', '被约束拦住', '居然插进去了', 'FAIL');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('已转赠的朋友券不能再直接核销', '被约束拦住', SQLERRM,
       CASE WHEN SQLERRM LIKE '%member_rewards_friend_transfer_check%' THEN 'PASS' ELSE 'FAIL' END);
  END;

  ------------------------------------------------------------------
  -- 10. 撤下 VIP 之后能正常激活下一张（不自动续，要手动）
  ------------------------------------------------------------------
  BEGIN
    PERFORM activate_member_vip(v_vip_c2, 'hermes_test');
    SELECT count(*) INTO v_cnt FROM member_benefits
     WHERE member_id = v_a AND activated_on IS NOT NULL
       AND v_today BETWEEN activated_on AND expires_on;
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('上一张过期后可以手动激活下一张', '1', v_cnt::text,
       CASE WHEN v_cnt = 1 THEN 'PASS' ELSE 'FAIL' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO chk (检查项, 期望, 实际, 结果) VALUES
      ('上一张过期后可以手动激活下一张', '1', '报错：' || SQLERRM, 'FAIL');
  END;
END $verify$;

SELECT 编号, 检查项, 期望, 实际, 结果 FROM chk ORDER BY 编号;

ROLLBACK;
