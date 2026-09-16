-- ============================================================
-- Tangdouren Club 会员系统 v1.2 — 第 1 步：会员主表与消费归属
--
-- 范围：
--   1) 新建 members 表（会员身份 + 加入同意记录）
--   2) timer_sessions 增加 member_id（消费归属）与 reward_eligible（结算进度资格）
--   3) RLS：与 timer_sessions 一致，全部走 service role
--
-- 说明：
--   1) 会员以邮箱为自然键。email 保留顾客原始输入，email_key 存
--      lower(btrim(email)) 并做唯一键，避免大小写 / 空格造出同一个人两条记录。
--   2) 不生成会员码。现场识别由店员在结算台按邮箱或姓名搜索会员完成。
--   3) Visit 不落计数器，由「有会员归属且已结算」的订单派生
--      （视图 member_visit_days 建在 017）。
--   4) 删除会员的处理方式：删除 members 行，member_id 经 ON DELETE SET NULL
--      自动断开，订单与金额保留不动（对应 UK GDPR 的删除请求）。
--   5) bookings 不加 member_id：预约上的会员身份不自动传递到 timer session，
--      预约邮箱只用于后台标注「这个人已经是会员」，因此只给 bookings.email
--      加一条规范化索引。
-- ============================================================

-- ── 1. members ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS members (
  member_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text        NOT NULL,               -- 顾客原始输入
  email_key      text        NOT NULL,               -- lower(btrim(email))，唯一键
  display_name   text,                               -- 姓名，供结算台搜索与展示
  joined_at      timestamptz NOT NULL DEFAULT NOW(), -- 加入会员时刻
  consent_at     timestamptz NOT NULL DEFAULT NOW(), -- 同意加入的时刻（留证）
  consent_source text        NOT NULL,               -- booking | in_store
  note           text,                               -- 店员备注
  is_active      boolean     NOT NULL DEFAULT true   -- 退会置 false，不删记录
);

-- 邮箱形状：必须有 @ 且 @ 后要有域名点号
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_email_shape_check;
ALTER TABLE members ADD CONSTRAINT members_email_shape_check
  CHECK (
    position('@' IN email) > 1
    AND position('.' IN split_part(email, '@', 2)) > 1
  );

-- email_key 必须真的是 email 的小写去空格形式，防止某条写入路径漏规范化
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_email_key_check;
ALTER TABLE members ADD CONSTRAINT members_email_key_check
  CHECK (email_key = lower(btrim(email)) AND btrim(email_key) <> '');

-- 同意来源只能是这两个入口（预约页勾选 / 门店登记）
ALTER TABLE members DROP CONSTRAINT IF EXISTS members_consent_source_check;
ALTER TABLE members ADD CONSTRAINT members_consent_source_check
  CHECK (consent_source IN ('booking', 'in_store'));

-- 一个邮箱一个人
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_email_key ON members(email_key);

CREATE INDEX IF NOT EXISTS idx_members_joined_at   ON members(joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_members_name_lookup ON members(lower(display_name));

-- RLS：与 014 对 timer_sessions 的处理一致 —— 只启用、不建策略。
-- 应用访问全部走 service role（lib/supabase/admin.ts），anon / authenticated
-- 拿公开的 publishable key 读不到任何会员数据。
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- ── 2. 消费归属字段 ──────────────────────────────────────────────────────────

-- 到店消费的归属：会员在自助计时页以会员身份开始时写入，或由店员在结算台补 Link
ALTER TABLE timer_sessions
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(member_id) ON DELETE SET NULL;

-- 本次消费是否计入 Reward Progress，在结算时固化，不在查询时按日期重推：
--   true  = 有会员归属，且结算那一刻该会员没有生效中的 VIP Month
--   false = 不计入（结算时 VIP 正在生效）
--   NULL  = 尚未判定（未结算的订单、以及本迁移之前的历史订单）
-- 之所以固化而不是现算：VIP Month 从激活那一刻起暂停进度，事后按日期重推会把
-- 激活当天早些时候已经完成的消费一起误伤掉。
ALTER TABLE timer_sessions
  ADD COLUMN IF NOT EXISTS reward_eligible boolean;

-- 只有归属到会员的单才可能计入奖励进度，防止某条写入路径把 true 写到散客单上
ALTER TABLE timer_sessions DROP CONSTRAINT IF EXISTS timer_sessions_reward_eligible_check;
ALTER TABLE timer_sessions ADD CONSTRAINT timer_sessions_reward_eligible_check
  CHECK (reward_eligible IS NOT TRUE OR member_id IS NOT NULL);

-- Visit 与 Reward Progress 都按 (member_id, is_settled) 过滤，这条索引直接服务该查询
CREATE INDEX IF NOT EXISTS idx_timer_sessions_member ON timer_sessions(member_id, is_settled);

-- 预约时按邮箱认会员，查询对大小写与首尾空格不敏感
CREATE INDEX IF NOT EXISTS idx_bookings_email_key    ON bookings(lower(btrim(email)));

-- ============================================================
-- ROLLBACK：
--   DROP INDEX IF EXISTS idx_bookings_email_key;
--   DROP INDEX IF EXISTS idx_timer_sessions_member;
--   ALTER TABLE timer_sessions DROP CONSTRAINT IF EXISTS timer_sessions_reward_eligible_check;
--   ALTER TABLE timer_sessions DROP COLUMN IF EXISTS reward_eligible;
--   ALTER TABLE timer_sessions DROP COLUMN IF EXISTS member_id;
--   DROP TABLE IF EXISTS members;
-- ============================================================
