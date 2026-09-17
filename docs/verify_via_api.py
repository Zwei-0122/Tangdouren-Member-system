#!/usr/bin/env python3
# ============================================================
# 会员系统真实数据验证（走 PostgREST + service key，不需要额外 token）
#
# 覆盖：视图计数与同日去重、解锁档位与幂等、VIP 激活与日期边界、
#       VIP 期间进度照常累积与「默认 VIP、可手动改用其他优惠」、£2 券核销与撤销回退、
#       朋友券用在他人的订单上、本人券不能给他人、刚解锁的奖励不能当次用、
#       撤销结算的守卫条件、后台补挂已结算订单的规矩。
#
# 会先清掉上次的测试数据（幂等可重跑），跑完保留数据供在界面上查看。
# ============================================================

import json
import urllib.error
import urllib.request
import pathlib
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ENV = pathlib.Path.home() / "Desktop/Projects/Tangdouren/.env.local"
cfg = {}
for line in ENV.read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")
U, K = cfg["NEXT_PUBLIC_SUPABASE_URL"], cfg["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}", "Content-Type": "application/json"}

L = ZoneInfo("Europe/London")
TODAY = datetime.now(L).date()
NOW = datetime.now(timezone.utc)


def req(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{U}{path}", data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try:
            j = json.loads(t)
        except Exception:
            j = {"message": t[:200]}
        return e.code, j


def sel(t, q):   return req("GET", f"/rest/v1/{t}?{q}")
def dele(t, q):  return req("DELETE", f"/rest/v1/{t}?{q}")
def rpc(fn, **p): return req("POST", f"/rest/v1/rpc/{fn}", p)


CHECKS = []


def check(name, expected, actual):
    ok = str(expected) == str(actual)
    CHECKS.append((name, str(expected), str(actual), "PASS" if ok else "FAIL"))


def err_of(resp):
    st, body = resp
    return body.get("message", "") if isinstance(body, dict) else ""


# ── 0. 清理（引用是个环：订单↔券↔奖励，必须按这个顺序解）───────────────────
EMAILS = ["demo.a@tangdouren.test", "demo.b@tangdouren.test"]
ids = []
for e in EMAILS:
    st, rows = sel("members", f"select=member_id&email_key=eq.{e}")
    if isinstance(rows, list):
        ids += [r["member_id"] for r in rows]

errors = []
def wipe(table, query, label):
    st, body = dele(table, query)
    if st not in (200, 204):
        errors.append(f"{label}: HTTP {st} {str(body)[:110]}")

def nullout(table, query, patch, label):
    st, body = req("PATCH", f"/rest/v1/{table}?{query}", patch)
    if st not in (200, 204):
        errors.append(f"{label}: HTTP {st} {str(body)[:110]}")

# 1) 权益 → 2) 奖励（解掉 奖励→券、奖励→订单 的引用）
for mid in ids:
    wipe("member_benefits", f"member_id=eq.{mid}", f"清权益 {mid[:8]}")
    wipe("member_rewards", f"member_id=eq.{mid}", f"清奖励 {mid[:8]}")
# 3) 订单不再指向券
nullout("timer_sessions", "session_id=like.DEMO-*",
        {"coupon_id": None, "coupon_code_snapshot": None}, "解订单→券")
# 4) 券不再指向订单（核销字段要么全空要么成组，所以三个一起清）
nullout("coupons", "code_prefix=eq.MB",
        {"redeemed_at": None, "redeemed_by": None, "redeemed_session_id": None}, "解券→订单")
# 5) 券 → 6) 订单 → 7) 会员
wipe("coupons", "code_prefix=eq.MB", "清内部券")
wipe("coupons", "code=eq.TDTEST0001", "清测试券")
for mid in ids:
    wipe("timer_sessions", f"member_id=eq.{mid}", f"清订单 {mid[:8]}")
    wipe("members", f"member_id=eq.{mid}", f"清会员 {mid[:8]}")
wipe("timer_sessions", "session_id=like.DEMO-*", "清剩余演示订单")

if errors:
    print("清理时报错：")
    for e in errors:
        print("  ", e)
# 复核：测试会员必须已经清干净，否则下面的检查会不准
for e in EMAILS:
    st, rows = sel("members", f"select=member_id&email_key=eq.{e}")
    if isinstance(rows, list) and rows:
        raise SystemExit(f"清理没成功：{e} 还在库里，先停下")

# ── 1. 会员 ─────────────────────────────────────────────────────────────────
st, rows = req("POST", "/rest/v1/members", [{
    "email": "demo.a@tangdouren.test", "email_key": "demo.a@tangdouren.test",
    "display_name": "甲", "consent_source": "in_store"}], prefer="return=representation")
A = rows[0]["member_id"]
st, rows = req("POST", "/rest/v1/members", [{
    "email": "demo.b@tangdouren.test", "email_key": "demo.b@tangdouren.test",
    "display_name": "乙", "consent_source": "booking"}], prefer="return=representation")
B = rows[0]["member_id"]


def add_session(sid, member_id, gbp, days_ago, settled=True, eligible=True):
    d = TODAY - timedelta(days=days_ago)
    row = {"session_id": sid, "customer_name": "测试", "status": "completed",
           "started_at": f"{d.isoformat()}T12:00:00+00:00",
           "stopped_at": f"{d.isoformat()}T13:00:00+00:00",
           "billing_minutes": 60, "elapsed_minutes": 60, "amount_gbp": gbp,
           "created_via": "self_service", "created_by": "hermes_test"}
    if member_id:
        row["member_id"] = member_id
    if settled:
        row.update({"is_settled": True, "settled_at": NOW.isoformat(), "settled_by": "hermes_test",
                    "actual_amount_gbp": gbp, "discount_amount_gbp": 0})
        if member_id:
            row["reward_eligible"] = eligible
    return req("POST", "/rest/v1/timer_sessions", [row], prefer="return=representation")


for i in range(1, 13):
    st, out = add_session(f"DEMO-A-{i:03d}", A, 13.99, 200 - i)
    assert st in (200, 201), out
add_session("DEMO-A-DUP", A, 13.99, 199)   # 与第 2 条同一天

# ── 2. 视图计数 / 同日去重 ───────────────────────────────────────────────────
st, rows = sel("member_visit_days", f"select=reward_eligible&member_id=eq.{A}")
check("A 累计到店 12 次（同一天多条只算 1）", 12, len(rows))
check("A 计入进度 12 次", 12, sum(1 for r in rows if r["reward_eligible"]))

# ── 3. 解锁与幂等 ───────────────────────────────────────────────────────────
st, out = rpc("ensure_member_rewards", p_member_id=A, p_session_id=None)
check("解锁调用成功", 200, st)
st, rows = sel("member_rewards",
               f"select=reward_type,cycle_index,coupon_id&member_id=eq.{A}&order=cycle_index,reward_type")
check("解锁 6 张（第一轮 5 + 第二轮 £2）", 6, len(rows))
check("档位与轮次都对",
      str(sorted([(1, "TWO_POUND"), (1, "FIVE_POUND"), (1, "PERSONAL_15_OFF"),
                  (1, "FRIEND_10_OFF"), (1, "VIP_MONTH"), (2, "TWO_POUND")])),
      str(sorted((r["cycle_index"], r["reward_type"]) for r in rows)))
check("券类奖励都挂了内部券", 3,
      sum(1 for r in rows if r["reward_type"] in ("TWO_POUND", "FIVE_POUND") and r["coupon_id"]))
st, cp = sel("coupons", "select=code,code_prefix&code_prefix=eq.MB")
check("内部券 code_prefix = MB（刚修的那个 bug）", 3, len(cp or []))
check("内部券码确实以 MB 开头", True, all(c["code"].startswith("MB") for c in (cp or [])))
st, out = rpc("ensure_member_rewards", p_member_id=A, p_session_id=None)
st, rows2 = sel("member_rewards", f"select=reward_id&member_id=eq.{A}")
check("重复调用不会多发（幂等）", 6, len(rows2))
st, ben = sel("member_benefits", f"select=benefit_id,reward_id,activated_on&member_id=eq.{A}")
check("VIP 解锁即建 1 条未激活权益", 1, len(ben or []))
check("VIP 不自动激活", None, (ben or [{}])[0].get("activated_on"))
vip_reward = (ben or [{}])[0].get("reward_id")

# ── 4. VIP 激活与日期边界 ───────────────────────────────────────────────────
st, out = rpc("activate_member_vip", p_reward_id=vip_reward, p_activated_by="hermes_test")
check("激活 VIP 成功", 200, st)
st, ben2 = sel("member_benefits", f"select=expires_on,activated_on&benefit_id=eq.{(ben or [{}])[0].get('benefit_id')}")
check("到期日 = 今天 + 29 天（伦敦日）", str(TODAY + timedelta(days=29)), (ben2 or [{}])[0].get("expires_on"))

def vip_at(ts):
    st, v = rpc("member_vip_active", p_member_id=A, p_at=ts)
    return v

def noon(d):
    return f"{d.isoformat()}T12:00:00+00:00"

check("激活当天已生效", True, vip_at(noon(TODAY)))
check("到期日当天仍有效", True, vip_at(noon(TODAY + timedelta(days=29))))
check("到期次日失效", False, vip_at(noon(TODAY + timedelta(days=30))))
check("激活前一天不算生效", False, vip_at(noon(TODAY - timedelta(days=1))))

st, r2 = req("POST", "/rest/v1/member_rewards", [{"member_id": A, "reward_type": "VIP_MONTH", "cycle_index": 9}],
             prefer="return=representation")
vip2 = r2[0]["reward_id"]
req("POST", "/rest/v1/member_benefits", [{"member_id": A, "reward_id": vip2}], prefer="return=representation")
st, out = rpc("activate_member_vip", p_reward_id=vip2, p_activated_by="hermes_test")
check("已有生效中的 VIP 时拒绝激活第二张", "VIP_ALREADY_ACTIVE", err_of((st, out)))
st, out = rpc("activate_member_vip", p_reward_id="00000000-0000-0000-0000-000000000000", p_activated_by="hermes_test")
check("激活一个不存在的奖励 → 报奖励不存在", "MEMBER_REWARD_NOT_FOUND", err_of((st, out)))

# 奖励存在但没有对应的权益行（例如被人手工删过）→ 报权益不存在
st, orphan = req("POST", "/rest/v1/member_rewards",
                 [{"member_id": A, "reward_type": "VIP_MONTH", "cycle_index": 91}],
                 prefer="return=representation")
st, out = rpc("activate_member_vip", p_reward_id=orphan[0]["reward_id"], p_activated_by="hermes_test")
check("奖励在但权益行缺失 → 报权益不存在", "MEMBER_BENEFIT_NOT_FOUND", err_of((st, out)))
wipe("member_rewards", f"reward_id=eq.{orphan[0]['reward_id']}", "清掉刚造的孤儿奖励")

# ── 5. VIP 期间结算：默认 85 折 + 进度照常累积 ──────────────────────────────
add_session("DEMO-VIP-1", A, 13.99, 0, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-VIP-1", p_settled_by="hermes_test",
              p_discount_amount_pence=210, p_discount_source="vip_month", p_member_id=A)
check("VIP 期间结算成功", 200, st)
st, rows = sel("timer_sessions", "select=actual_amount_gbp,reward_eligible,discount_amount_gbp&session_id=eq.DEMO-VIP-1")
check("VIP 自动 85 折（13.99 → 11.89）", "11.89", rows[0]["actual_amount_gbp"])
check("折扣金额记为 £2.10", 2.10, round(float(rows[0]["discount_amount_gbp"]), 2))
check("VIP 期间的单照常计入 Reward Progress（业主 2026-09-16 口径）", True, rows[0]["reward_eligible"])
st, rows = sel("member_visit_days", "select=reward_eligible&member_id=eq." + A)
check("VIP 期间 Lifetime 照常加（→13）", 13, len(rows))
check("VIP 期间 Reward Progress 照常加（→13）", 13, sum(1 for r in rows if r["reward_eligible"]))

# ── 6. VIP 期间：不选优惠被拦，改用券或奖励放行（业主 2026-09-16 口径）──────
add_session("DEMO-VIP-2", A, 13.99, 0, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-VIP-2", p_settled_by="hermes_test",
              p_discount_amount_pence=0, p_discount_source="none")
check("VIP 期间「不使用优惠」被拦（会员不该按原价结账）", "VIP_MUST_BE_APPLIED", err_of((st, out)))

st, out = rpc("settle_timer_session", p_session_id="DEMO-VIP-2", p_settled_by="hermes_test",
              p_discount_amount_pence=200, p_discount_source="member_reward",
              p_member_id=A, p_reward_type="TWO_POUND")
check("VIP 期间可以改用会员奖励（当次放弃 VIP 折扣）", 200, st)
st, rows = sel("timer_sessions", "select=actual_amount_gbp&session_id=eq.DEMO-VIP-2")
check("改用 £2 券后金额 13.99 → 11.99", "11.99", rows[0]["actual_amount_gbp"])
st, out = rpc("unsettle_timer_session", p_session_id="DEMO-VIP-2")
check("把这一单撤销回来，供下一步复用", 200, st)

st, cpn = req("POST", "/rest/v1/coupons", [{"code": "TDTEST0001", "code_prefix": "TD",
              "discount_type": "percentage_off", "discount_value": 10, "created_by": "hermes_test"}],
              prefer="return=representation")
st, out = rpc("settle_timer_session", p_session_id="DEMO-VIP-2", p_settled_by="hermes_test",
              p_coupon_code="TDTEST0001", p_discount_amount_pence=140, p_discount_source="coupon")
check("VIP 期间也可以改用普通优惠券", 200, st)
st, rows = sel("timer_sessions", "select=actual_amount_gbp&session_id=eq.DEMO-VIP-2")
check("改用 10% 券后金额 13.99 → 12.59", "12.59", rows[0]["actual_amount_gbp"])
st, out = rpc("unsettle_timer_session", p_session_id="DEMO-VIP-2")
check("再撤销回来，回到未结算", 200, st)

# ── 7. 让 VIP 过期，回到非 VIP ─────────────────────────────────────────────
st, ben3 = sel("member_benefits", f"select=benefit_id&member_id=eq.{A}")
bid = (ben3 or [{}])[0]["benefit_id"]
req("PATCH", f"/rest/v1/member_benefits?benefit_id=eq.{bid}",
    {"activated_on": str(TODAY - timedelta(days=40)), "activated_at": NOW.isoformat(),
     "expires_on": str(TODAY - timedelta(days=11)), "activated_by": "hermes_test"})
check("把激活日改到 40 天前后 VIP 不再生效", False, vip_at(noon(TODAY)))

# ── 8. £2 抵用券：核销与撤销回退 ────────────────────────────────────────────
add_session("DEMO-A-VCH", A, 13.99, 1, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-A-VCH", p_settled_by="hermes_test",
              p_discount_amount_pence=200, p_discount_source="member_reward",
              p_member_id=A, p_reward_type="TWO_POUND")
check("£2 抵用券结算成功", 200, st)
st, rows = sel("timer_sessions", "select=actual_amount_gbp&session_id=eq.DEMO-A-VCH")
check("£2 抵用券结算金额（13.99 → 11.99）", "11.99", rows[0]["actual_amount_gbp"])
st, rows = sel("member_rewards",
               f"select=cycle_index,used_at,coupon_id&member_id=eq.{A}&reward_type=eq.TWO_POUND&used_at=not.is.null")
check("只核销了 1 张 £2（同类多张取最早）", 1, len(rows))
st, rc = sel("coupons", f"select=redeemed_session_id,redeemed_at,code&coupon_id=eq.{rows[0]['coupon_id']}")
check("对应内部券同步核销到本单", "DEMO-A-VCH", rc[0]["redeemed_session_id"])

st, out = rpc("unsettle_timer_session", p_session_id="DEMO-A-VCH")
check("撤销结算成功", 200, st)
st, rows = sel("member_rewards",
               f"select=used_at,used_session_id&member_id=eq.{A}&reward_type=eq.TWO_POUND&cycle_index=eq.1")
check("撤销后 £2 退回未使用", None, rows[0]["used_at"])
st, rc = sel("coupons", "select=redeemed_at,code&code=eq." + rc[0]["code"])
check("撤销后内部券回到未核销", None, rc[0]["redeemed_at"])
st, rows = sel("timer_sessions", "select=reward_eligible,is_settled&session_id=eq.DEMO-A-VCH")
check("撤销后进度资格清空", None, rows[0]["reward_eligible"])
check("撤销后订单回到未结算", False, rows[0]["is_settled"])

# ── 9. 朋友 9 折能用在他人的订单上 / 本人券不能 ─────────────────────────────
add_session("DEMO-GUEST-1", None, 13.99, 2, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-GUEST-1", p_settled_by="hermes_test",
              p_discount_amount_pence=140, p_discount_source="member_reward",
              p_member_id=A, p_reward_type="FRIEND_10_OFF")
check("朋友 9 折可用在非会员的订单上", 200, st)
st, rows = sel("timer_sessions", "select=actual_amount_gbp,reward_eligible&session_id=eq.DEMO-GUEST-1")
check("朋友券结算金额（13.99 → 12.59）", "12.59", rows[0]["actual_amount_gbp"])
check("非会员订单不产生任何人进度", None, rows[0]["reward_eligible"])

add_session("DEMO-GUEST-2", None, 13.99, 3, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-GUEST-2", p_settled_by="hermes_test",
              p_discount_amount_pence=210, p_discount_source="member_reward",
              p_member_id=A, p_reward_type="PERSONAL_15_OFF")
check("本人 85 折不能用在他人订单上", "MEMBER_SESSION_MISMATCH", err_of((st, out)))

# ── 10. B：刚解锁的奖励不能用于产生它的那笔消费 ──────────────────────────────
add_session("DEMO-B-001", B, 13.99, 30)
add_session("DEMO-B-002", B, 13.99, 29, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-B-002", p_settled_by="hermes_test",
              p_discount_amount_pence=200, p_discount_source="member_reward",
              p_member_id=B, p_reward_type="TWO_POUND")
check("刚解锁的奖励不能用于产生它的那笔消费", "MEMBER_REWARD_UNAVAILABLE", err_of((st, out)))

st, out = rpc("settle_timer_session", p_session_id="DEMO-B-002", p_settled_by="hermes_test",
              p_discount_amount_pence=0, p_discount_source="none")
check("同一笔改成不使用优惠后结算成功", 200, st)
st, rows = sel("member_rewards",
               f"select=unlocked_by_session_id,used_at&member_id=eq.{B}&reward_type=eq.TWO_POUND&cycle_index=eq.1")
check("这笔结算解锁了 £2 且未被自己用掉", "DEMO-B-002", rows[0]["unlocked_by_session_id"])
check("刚解锁的奖励 used_at 为空", None, rows[0]["used_at"])

# ── 11. 撤销守卫：奖励已被后续用掉则不许撤销来源结算 ─────────────────────────
add_session("DEMO-B-003", B, 13.99, 28, settled=False)
st, out = rpc("settle_timer_session", p_session_id="DEMO-B-003", p_settled_by="hermes_test",
              p_discount_amount_pence=200, p_discount_source="member_reward",
              p_member_id=B, p_reward_type="TWO_POUND")
check("第二笔用掉那张刚解锁的 £2", 200, st)
st, out = rpc("unsettle_timer_session", p_session_id="DEMO-B-002")
check("奖励已被后续使用则拒绝撤销来源结算", "REWARD_ALREADY_USED", err_of((st, out)))

# ── 11b. Link to Member：未结算可挂；已结算的补挂只记到店次数 ───────────────
add_session("DEMO-LINK-1", None, 13.99, 5, settled=False)
st, out = rpc("link_timer_session_to_member", p_session_id="DEMO-LINK-1", p_member_id=B)
check("未结算的订单可以挂到会员", 200, st)
st, rows = sel("timer_sessions", "select=member_id,reward_eligible&session_id=eq.DEMO-LINK-1")
check("挂上去之后归属正确", B, rows[0]["member_id"])
check("未结算的单挂上后进度资格仍是 NULL（等结算时判定）", None, rows[0]["reward_eligible"])

st, vbefore = sel("member_visit_days", f"select=reward_eligible&member_id=eq.{B}")
add_session("DEMO-LINK-2", None, 13.99, 6)
st, out = rpc("link_timer_session_to_member", p_session_id="DEMO-LINK-2", p_member_id=B)
check("已结算的散客单允许补挂（业主 2026-09-16 口径）", 200, st)
st, rows = sel("timer_sessions", "select=member_id,reward_eligible,actual_amount_gbp&session_id=eq.DEMO-LINK-2")
check("补挂后归属正确", B, rows[0]["member_id"])
check("补挂只记到店：reward_eligible = false", False, rows[0]["reward_eligible"])
check("补挂不动已收金额", "13.99", rows[0]["actual_amount_gbp"])
st, vafter = sel("member_visit_days", f"select=reward_eligible&member_id=eq.{B}")
check("补挂让 Lifetime 加 1", len(vbefore or []) + 1, len(vafter or []))
check("补挂不让进度加",
      sum(1 for x in (vbefore or []) if x["reward_eligible"]),
      sum(1 for x in (vafter or []) if x["reward_eligible"]))

st, out = rpc("link_timer_session_to_member", p_session_id="DEMO-LINK-2", p_member_id=A)
check("已结算且已归属的单不能再改到别的会员", "SESSION_ALREADY_LINKED", err_of((st, out)))

st, out = rpc("link_timer_session_to_member", p_session_id="DEMO-LINK-1", p_member_id="00000000-0000-0000-0000-000000000000")
check("挂到不存在的会员会被拒", "MEMBER_NOT_FOUND", err_of((st, out)))

# ── 12. 结果 ────────────────────────────────────────────────────────────────
print("=" * 96)
print(f"{'结果':<5} {'检查项':<52} {'期望':<26} 实际")
print("-" * 96)
for name, exp, act, res in CHECKS:
    print(f"{res:<5} {name:<52} {exp[:25]:<26} {act[:28]}")
print("-" * 96)
npass = sum(1 for c in CHECKS if c[3] == "PASS")
print(f"通过 {npass}/{len(CHECKS)}")
if npass != len(CHECKS):
    print("\n未通过：")
    for name, exp, act, res in CHECKS:
        if res == "FAIL":
            print(f"  - {name}: 期望 {exp}，实际 {act}")

print("\n" + "=" * 96)
print("留下的可查看数据（测试项目）")
for label, mid in [("甲 demo.a@tangdouren.test", A), ("乙 demo.b@tangdouren.test", B)]:
    st, v = sel("member_visit_days", f"select=reward_eligible&member_id=eq.{mid}")
    st, rw = sel("member_rewards", f"select=reward_type,cycle_index,used_at&member_id=eq.{mid}")
    st, bn = sel("member_benefits", f"select=activated_on,expires_on&member_id=eq.{mid}")
    print(f"  {label}: 到店 {len(v or [])} 次 / 计入进度 {sum(1 for x in (v or []) if x['reward_eligible'])} 次"
          f" / 奖励 {len(rw or [])} 张 / VIP 权益 {len(bn or [])} 条")
print(f"  会员 ID: 甲={A}  乙={B}")
