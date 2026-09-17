#!/usr/bin/env python3
# ============================================================
# 场景演练：按店里的真实流程把会员系统走一遍（轻量、可重复跑）
#
# 顾客侧走本地 dev server 的真实接口：/api/self-timer/start、/api/member/*
# 店员侧走后台页面调用的同一个数据库函数：settle_timer_session、unsettle_timer_session、
#        link_timer_session_to_member、activate_member_vip
# 时间等不起的场景（同一天两次、跨夜、VIP 到期）直接造数据，因为时钟拨不动。
#
# 只动 walk.*@tangdouren.test 这几个演练身份，跑完清干净（KEEP=1 保留现场）。
# 前置：dev server 起在 3002（用 BASE 环境变量可改）。
# ============================================================

import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BASE = os.environ.get("BASE", "http://localhost:3002")
KEEP = os.environ.get("KEEP") == "1"
REPO = pathlib.Path.home() / "Desktop/Projects/Tangdouren"

cfg = {}
for line in (REPO / ".env.local").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")
U, K = cfg["NEXT_PUBLIC_SUPABASE_URL"], cfg["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": K, "Authorization": f"Bearer {K}", "Content-Type": "application/json"}

L = ZoneInfo("Europe/London")
TODAY = datetime.now(L).date()
NOW = datetime.now(timezone.utc)

MEI   = "walk.mei@tangdouren.test"      # 会员：小梅（主场景）
QIANG = "walk.qiang@tangdouren.test"    # 小梅的朋友：阿强（不是会员）
DONG  = "walk.dong@tangdouren.test"     # 用来试时间口径：小冬
WALK_EMAILS = [MEI, QIANG, DONG]
TAG = "演练-"                            # 演练单的顾客名统一以此开头，便于清理


# ── 两条通道：数据库（PostgREST + service key）与本地站点接口 ────────────────
def req(method, path, body=None, prefer=None):
    h = dict(H)
    if prefer:
        h["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    if not path.isascii():                     # 中文过滤条件（比如顾客名 like 演练-*）要先转义
        head, _, query = path.partition("?")
        path = head + "?" + urllib.parse.quote(query, safe="=&,.*:-()")
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


def sel(t, q):    return req("GET", f"/rest/v1/{t}?{q}")
def dele(t, q):   return req("DELETE", f"/rest/v1/{t}?{q}")
def rpc(fn, **p): return req("POST", f"/rest/v1/rpc/{fn}", p)


def api(path, body):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            t = resp.read().decode()
            return resp.status, (json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()
        try:
            j = json.loads(t)
        except Exception:
            j = {"error": t[:200]}
        return e.code, j


STEPS = []


def check(scene, expected, actual):
    ok = str(expected) == str(actual)
    STEPS.append((scene, str(expected), str(actual), ok))
    print(("  ✓ " if ok else "  ✗ ") + scene + ("" if ok else f"   期望 {expected} / 实际 {actual}"))
    return ok


def note(scene, text):
    STEPS.append((scene, "（记录）", text, None))
    print("  · " + scene + "：" + text)


def err(resp):
    st, b = resp
    return (b or {}).get("message", "") if isinstance(b, dict) else ""


# ── 造单与查数 ──────────────────────────────────────────────────────────────
_seq = {"i": 0}


def mk(member_id, days_ago, gbp=13.99, settled=False, eligible=True, start_iso=None, stop_iso=None):
    """造一张计时单。不给 start_iso 时用 12:00 UTC（伦敦下午），给的话用来试跨夜/时区口径。"""
    _seq["i"] += 1
    sid = f"WALK-{_seq['i']:03d}"
    d = TODAY - timedelta(days=days_ago)
    row = {"session_id": sid, "customer_name": TAG + "会员", "status": "completed",
           "started_at": start_iso or f"{d.isoformat()}T12:00:00+00:00",
           "stopped_at": stop_iso or f"{d.isoformat()}T13:00:00+00:00",
           "billing_minutes": 60, "elapsed_minutes": 60, "amount_gbp": gbp,
           "created_via": "self_service", "created_by": "walk_test"}
    if member_id:
        row["member_id"] = member_id
    if settled:
        row.update({"is_settled": True, "settled_at": NOW.isoformat(), "settled_by": "演练店员",
                    "actual_amount_gbp": gbp, "discount_amount_gbp": 0})
        if member_id:
            row["reward_eligible"] = eligible
    st, out = req("POST", "/rest/v1/timer_sessions", [row], prefer="return=representation")
    assert st in (200, 201), out
    return sid


def stop(sid, gbp=13.99, minutes=60):
    """店员点「结束计时」：真实流程里这步由页面做，这里直接写结果。"""
    return req("PATCH", f"/rest/v1/timer_sessions?session_id=eq.{sid}",
               {"status": "completed", "stopped_at": NOW.isoformat(),
                "billing_minutes": minutes, "elapsed_minutes": minutes, "amount_gbp": gbp})


def settle(sid, source, pence, member=None, reward=None, coupon=None):
    p = {"p_session_id": sid, "p_settled_by": "演练店员",
         "p_discount_source": source, "p_discount_amount_pence": pence}
    if member: p["p_member_id"] = member
    if reward: p["p_reward_type"] = reward
    if coupon: p["p_coupon_code"] = coupon
    return rpc("settle_timer_session", **p)


def sess(sid, fields="actual_amount_gbp,reward_eligible,member_id,is_settled,discount_amount_gbp"):
    st, rows = sel("timer_sessions", f"select={fields}&session_id=eq.{sid}")
    return (rows or [{}])[0]


def days_of(mid):
    st, rows = sel("member_visit_days",
                   f"select=visit_date,reward_eligible&member_id=eq.{mid}&order=visit_date")
    return rows or []


def rewards_of(mid):
    st, rows = sel("member_rewards",
                   f"select=reward_type,cycle_index,used_at,reward_id&member_id=eq.{mid}"
                   f"&order=cycle_index,reward_type")
    return rows or []


def reward_set(mid):
    return sorted((r["cycle_index"], r["reward_type"]) for r in rewards_of(mid))


def member_id_of(email):
    st, rows = sel("members", f"select=member_id&email_key=eq.{email}")
    return (rows or [{}])[0].get("member_id")


# ── 清理（引用是个环：权益 → 奖励 → 券 → 订单 → 会员，必须按序解）──────────
def wipe_all(quiet=False):
    """清掉演练留下的一切。引用是个环，只能按这个顺序解：
       奖励 → 权益 → 券的核销字段（从券这侧解）→ 单 → 会员 → 券。"""
    ids = [i for i in (member_id_of(e) for e in WALK_EMAILS) if i]
    errs = []

    def w(table, query, label):
        st, body = dele(table, query)
        if st not in (200, 204):
            errs.append(f"{label}: HTTP {st} {str(body)[:110]}")

    def n(table, query, patch, label):
        st, body = req("PATCH", f"/rest/v1/{table}?{query}", patch)
        if st not in (200, 204):
            errs.append(f"{label}: HTTP {st} {str(body)[:110]}")

    # 演练的单：自己造的 WALK-*，加上走接口建的（顾客名带「演练-」前缀）
    st, rows = sel("timer_sessions",
                   f"select=session_id&or=(session_id.like.WALK-*,customer_name.like.{TAG}*)")
    sids = [r["session_id"] for r in (rows or [])]

    # 演练的券：会员奖励挂着的，加上被演练单核销掉的
    st, rw = sel("member_rewards", "select=coupon_id,coupon:coupon_id&coupon_id=not.is.null"
                 + (f"&member_id=in.({','.join(ids)})" if ids else "&member_id=is.null"))
    own = [r["coupon_id"] for r in (rw or [])]
    if sids:
        st, cs = sel("coupons", "select=coupon_id&redeemed_session_id=in.(" + ",".join(sids) + ")")
        own += [c["coupon_id"] for c in (cs or [])]
    own = sorted(set(own))

    for mid in ids:
        w("member_benefits", f"member_id=eq.{mid}", f"清权益 {mid[:8]}")
        w("member_rewards", f"member_id=eq.{mid}", f"清奖励 {mid[:8]}")
    if own:
        n("coupons", "coupon_id=in.(" + ",".join(own) + ")",
          {"redeemed_at": None, "redeemed_by": None, "redeemed_session_id": None}, "解券→单")
    if sids:
        w("timer_sessions", "session_id=in.(" + ",".join(sids) + ")", "清演练单")
    for mid in ids:
        w("members", f"member_id=eq.{mid}", f"清会员 {mid[:8]}")
    if own:
        w("coupons", "coupon_id=in.(" + ",".join(own) + ")", "清演练内部券")

    if errs and not quiet:
        print("清理时报错：")
        for e in errs:
            print("  ", e)
    for e in WALK_EMAILS:
        if member_id_of(e):
            raise SystemExit(f"清理没干净：{e} 还在库里，先停下")


# ── 开局：清场 + 建演练身份 ─────────────────────────────────────────────────
try:
    with urllib.request.urlopen(BASE + "/self-timer", timeout=10) as r:
        assert r.status == 200
except Exception as e:
    raise SystemExit(f"dev server 不在 {BASE}（{e}）——先 npm run dev -- -p 3002")

wipe_all()

st, rows = req("POST", "/rest/v1/members", [
    {"email": MEI, "email_key": MEI, "display_name": "小梅", "consent_source": "in_store"},
], prefer="return=representation")
MEI_ID = rows[0]["member_id"]
st, rows = req("POST", "/rest/v1/members", [
    {"email": QIANG, "email_key": QIANG, "display_name": "阿强", "consent_source": "booking"},
], prefer="return=representation")
QIANG_ID = rows[0]["member_id"]
st, rows = req("POST", "/rest/v1/members", [
    {"email": DONG, "email_key": DONG, "display_name": "小冬", "consent_source": "in_store"},
], prefer="return=representation")
DONG_ID = rows[0]["member_id"]

# 期望账本：小梅的到店日（lifetime）与计入进度的到店日（progress）
life, prog = set(), set()


def add_day(day, mode="both"):
    if mode == "both":
        life.add(day); prog.add(day)
    elif mode == "life":
        life.add(day)


def assert_book(p, label):
    st, rows = sel("member_visit_days", f"select=visit_date,reward_eligible&member_id=eq.{MEI_ID}")
    got_life = sorted(r["visit_date"] for r in (rows or []))
    got_prog = sorted(r["visit_date"] for r in (rows or []) if r["reward_eligible"])
    check(f"{label} · 累计到店 {len(life)} 次", sorted(str(d) for d in life), got_life)
    check(f"{label} · 奖励进度 {len(prog)} 次", sorted(str(d) for d in prog), got_prog)


D = TODAY
day = lambda n: str(D - timedelta(days=n))

print("=" * 100)
print("场景演练开始：" + datetime.now(L).strftime("%Y-%m-%d %H:%M") + "（伦敦）")
print("=" * 100)

# ═══ A. 顾客扫桌上的码，自己开始计时（走真实接口）═══════════════════════════
st1, a1 = api("/api/self-timer/start", {"tableNumber": "S1", "seatNumber": "S1-A",
                                        "customerName": TAG + "散客", "confirmNoMixedBeans": True})
check("A1 散客不填邮箱也能开始计时", 201, st1)
GUEST_SID = (a1 or {}).get("sessionId", "")
check("A1 这张单没有会员归属", None, sess(GUEST_SID).get("member_id"))

st2, a2 = api("/api/self-timer/start", {"tableNumber": "S2", "seatNumber": "S2-A",
                                        "customerName": TAG + "小梅",
                                        "memberEmail": "  Walk.Mei@Tangdouren.Test  ",
                                        "confirmNoMixedBeans": True})
check("A2 会员填邮箱（大小写与空格都不规范）照样认出来", 201, st2)
MEI_SID_1 = (a2 or {}).get("sessionId", "")
check("A2 这一单归到小梅名下", MEI_ID, sess(MEI_SID_1).get("member_id"))

st3, a3 = api("/api/self-timer/start", {"tableNumber": "S3", "seatNumber": "S3-A",
                                        "customerName": TAG + "陌生邮箱",
                                        "memberEmail": "nobody.here@tangdouren.test",
                                        "confirmNoMixedBeans": True})
check("A3 输了一个没注册过的邮箱，也照样能开始计时（不挡生意）", 201, st3)
check("A3 这张单按普通顾客处理", None, sess((a3 or {}).get("sessionId", "")).get("member_id"))

IDEM = f"walk-idem-{TODAY.isoformat()}"
st4a, b4a = api("/api/self-timer/start", {"tableNumber": "D1", "seatNumber": "D1-A",
                                          "customerName": TAG + "小梅", "memberEmail": MEI,
                                          "idempotencyKey": IDEM, "confirmNoMixedBeans": True})
st4b, b4b = api("/api/self-timer/start", {"tableNumber": "D1", "seatNumber": "D1-A",
                                          "customerName": TAG + "小梅", "memberEmail": MEI,
                                          "idempotencyKey": IDEM, "confirmNoMixedBeans": True})
MEI_SID_2 = (b4a or {}).get("sessionId", "")
check("A4 顾客手抖点两次不会开出两张单", (b4a or {}).get("sessionId"), (b4b or {}).get("sessionId"))
st, rows = sel("timer_sessions", f"select=session_id&idempotency_key=eq.{IDEM}")
check("A4 库里也只有一张", 1, len(rows or []))

# ═══ B. 结算：散客与会员，同日与跨夜 ═══════════════════════════════════════
stop(GUEST_SID)
st, out = settle(GUEST_SID, "none", 0)
check("B1 散客单结算成功", 200, st)
g = sess(GUEST_SID)
check("B1 散客单按原价收，金额 13.99", "13.99", g.get("actual_amount_gbp"))
check("B1 散客单不产生任何人的到店次数", None, g.get("reward_eligible"))

stop(MEI_SID_1)
check("B2 小梅今天第一单结算成功", 200, settle(MEI_SID_1, "none", 0)[0])
add_day(D)
assert_book("B2", "B2 小梅今天来了一次")
check("B2 这一单计入奖励进度", True, sess(MEI_SID_1).get("reward_eligible"))

stop(MEI_SID_2)
check("B3 同一天第二单结算成功", 200, settle(MEI_SID_2, "none", 0)[0])
assert_book("B3", "B3 同一天来两次只算一次")

# 跨夜：23:40 开始、次日 00:20 结束 → 算到开始那天
mk(DONG_ID, 0, settled=True, start_iso=f"{day(60)}T22:40:00+00:00",
   stop_iso=f"{day(60)}T23:20:00+00:00")
st, rows = sel("member_visit_days", f"select=visit_date&member_id=eq.{DONG_ID}")
check("B4 23:40 开始、00:20 结束的单算在开始那天", [day(60)], [r["visit_date"] for r in (rows or [])])

# 伦敦时间凌晨 00:30 开始的单（UTC 还停在前一天）→ 算在伦敦的那天
sid_night = "WALK-NIGHT"
req("POST", "/rest/v1/timer_sessions", [{
    "session_id": sid_night, "customer_name": TAG + "小冬", "member_id": DONG_ID,
    "status": "completed", "started_at": f"{day(63)}T23:30:00+00:00",
    "stopped_at": f"{day(63)}T23:59:00+00:00", "billing_minutes": 60, "elapsed_minutes": 60,
    "amount_gbp": 13.99, "is_settled": True, "settled_at": NOW.isoformat(), "settled_by": "演练店员",
    "actual_amount_gbp": 13.99, "discount_amount_gbp": 0, "reward_eligible": True,
    "created_via": "self_service", "created_by": "walk_test"}], prefer="return=representation")
st, rows = sel("member_visit_days", f"select=visit_date&member_id=eq.{DONG_ID}&order=visit_date")
check("B5 按伦敦日期归档，不是按 UTC", sorted([day(62), day(60)]),
      [r["visit_date"] for r in (rows or [])])

# ═══ C. 奖励解锁与核销 ═════════════════════════════════════════════════════
sid_20 = mk(MEI_ID, 20, settled=False)
check("C1 第 2 次到店结算成功", 200, settle(sid_20, "none", 0)[0])
add_day(day(20))
assert_book("C1", "C1 小梅第 2 次到店")
check("C1 解锁 £2 抵用券（第一轮）", sorted([(1, "TWO_POUND")]), reward_set(MEI_ID))

sid_19 = mk(MEI_ID, 19, settled=False)
st, out = settle(sid_19, "member_reward", 200, member=MEI_ID, reward="TWO_POUND")
check("C2 顾客用 £2 抵用券结账", 200, st)
check("C2 金额 13.99 → 11.99", "11.99", sess(sid_19).get("actual_amount_gbp"))
used = [r for r in rewards_of(MEI_ID) if r["used_at"]]
check("C2 这张券标记为已用", 1, len(used))
st, cr = sel("member_rewards", f"select=coupon_id&member_id=eq.{MEI_ID}"
                                 f"&reward_type=eq.TWO_POUND&used_at=not.is.null")
COUPON_1 = (cr or [{}])[0].get("coupon_id")
st, cp = sel("coupons", f"select=redeemed_session_id,code&coupon_id=eq.{COUPON_1}") if COUPON_1 else (0, None)
check("C2 内部券同步核销到这张单", sid_19,
      (cp[0].get("redeemed_session_id") if isinstance(cp, list) and cp else None))
if not COUPON_1:
    note("C2 没拿到这张奖励对应的内部券", f"查询返回 {cp}")
add_day(day(19))

sid_18 = mk(MEI_ID, 18, settled=False)
st, out = settle(sid_18, "member_reward", 200, member=MEI_ID, reward="TWO_POUND")
check("C3 手里已经没有可用的 £2，再想用一张会被拦", True, st >= 400)
note("C3 拦下来的原话", f"HTTP {st} {err((st, out))}")

st, out = rpc("unsettle_timer_session", p_session_id=sid_19)
check("C4 撤销结算成功", 200, st)
st, rws = sel("member_rewards", f"select=used_at&member_id=eq.{MEI_ID}&reward_type=eq.TWO_POUND")
check("C4 撤销后 £2 退回未使用", True, all(r["used_at"] is None for r in (rws or [])))
st, cp2 = sel("coupons", f"select=redeemed_at&coupon_id=eq.{COUPON_1}")
check("C4 内部券也回到未核销", None, (cp2 or [{}])[0].get("redeemed_at"))
prog.discard(day(19)); life.discard(day(19))
assert_book("C4", "C4 撤销后到店次数回退")
st, out = rpc("unsettle_timer_session", p_session_id=sid_19)
check("C5 已经撤销过的单再撤一次会被拦", True, st >= 400)
note("C5 拦下来的原话", f"HTTP {st} {err((st, out))}")

check("C6 重结 C3 那张单（这次不用优惠）", 200, settle(sid_18, "none", 0)[0])
add_day(day(18))
sid_17 = mk(MEI_ID, 17, settled=False)
check("C6 第 4 次到店结算成功", 200, settle(sid_17, "none", 0)[0]); add_day(day(17))
sid_16 = mk(MEI_ID, 16, settled=False)
check("C6 第 5 次到店结算成功", 200, settle(sid_16, "none", 0)[0]); add_day(day(16))
assert_book("C6", "C6 小梅第 5 次到店")
check("C6 解锁 £5 抵用券", sorted([(1, "FIVE_POUND"), (1, "TWO_POUND")]), reward_set(MEI_ID))

for n in (15, 14, 13):
    sid = mk(MEI_ID, n, settled=False)
    settle(sid, "none", 0); add_day(day(n))
assert_book("C7", "C7 小梅第 8 次到店")
check("C7 第 8 次解锁本人 85 折 + 朋友 9 折",
      sorted([(1, "FIVE_POUND"), (1, "FRIEND_10_OFF"), (1, "PERSONAL_15_OFF"), (1, "TWO_POUND")]),
      reward_set(MEI_ID))

sid_friend = mk(QIANG_ID, 25, settled=False)
st, out = settle(sid_friend, "member_reward", 140, member=MEI_ID, reward="FRIEND_10_OFF")
check("C8 朋友 9 折能用在朋友那桌的单上", 200, st)
check("C8 金额 13.99 → 12.59", "12.59", sess(sid_friend).get("actual_amount_gbp"))

sid_wrong = mk(QIANG_ID, 24, settled=False)
st, out = settle(sid_wrong, "member_reward", 210, member=MEI_ID, reward="PERSONAL_15_OFF")
check("C9 本人的 85 折不能用在别人的单上", "MEMBER_SESSION_MISMATCH", err((st, out)))

for n in (12, 11):
    sid = mk(MEI_ID, n, settled=False)
    settle(sid, "none", 0); add_day(day(n))
assert_book("C10", "C10 小梅第 10 次到店")
check("C10 第 10 次解锁 VIP 月卡", sorted([(1, "FIVE_POUND"), (1, "FRIEND_10_OFF"),
      (1, "PERSONAL_15_OFF"), (1, "TWO_POUND"), (1, "VIP_MONTH")]), reward_set(MEI_ID))
st, ben = sel("member_benefits", f"select=benefit_id,reward_id,activated_on&member_id=eq.{MEI_ID}")
check("C10 月卡解锁后是「未激活」，不会自己开始算", None, (ben or [{}])[0].get("activated_on"))
VIP1_REWARD = (ben or [{}])[0].get("reward_id")
VIP1_BENEFIT = (ben or [{}])[0].get("benefit_id")

# ═══ D. VIP 月卡生效期间，柜台怎么收钱 ═════════════════════════════════════
st, out = rpc("activate_member_vip", p_reward_id=VIP1_REWARD, p_activated_by="演练店员")
check("D1 激活月卡成功", 200, st)
st, b = sel("member_benefits", f"select=activated_on,expires_on&benefit_id=eq.{VIP1_BENEFIT}")
check("D1 30 天含首尾：到期日 = 激活日 + 29 天", str(D + timedelta(days=29)), (b or [{}])[0].get("expires_on"))
noon = lambda d: f"{d.isoformat()}T12:00:00+00:00"
check("D1 激活当天就算生效", True, rpc("member_vip_active", p_member_id=MEI_ID, p_at=noon(D))[1])
check("D1 到期日当天仍然生效", True, rpc("member_vip_active", p_member_id=MEI_ID, p_at=noon(D + timedelta(days=29)))[1])
check("D1 到期次日失效", False, rpc("member_vip_active", p_member_id=MEI_ID, p_at=noon(D + timedelta(days=30)))[1])

sid_10 = mk(MEI_ID, 10, settled=False)
st, out = settle(sid_10, "vip_month", 210, member=MEI_ID)
check("D2 VIP 期间来店结算成功", 200, st)
check("D2 自动按 85 折收：13.99 → 11.89", "11.89", sess(sid_10).get("actual_amount_gbp"))
check("D2 VIP 期间消费照常计入奖励进度", True, sess(sid_10).get("reward_eligible"))
add_day(day(10)); assert_book("D2", "D2 小梅第 11 次到店")

sid_9 = mk(MEI_ID, 9, settled=False)
st, out = settle(sid_9, "member_reward", 200, member=MEI_ID, reward="TWO_POUND")
check("D3 VIP 期间店员改用 £2 券（当次不要 VIP 折扣）", 200, st)
check("D3 金额变成 11.99", "11.99", sess(sid_9).get("actual_amount_gbp"))
add_day(day(9))
check("D3 第 12 次到店解锁第二轮的 £2", sorted([(2, "TWO_POUND"), (1, "FIVE_POUND"),
      (1, "FRIEND_10_OFF"), (1, "PERSONAL_15_OFF"), (1, "TWO_POUND"), (1, "VIP_MONTH")]),
      reward_set(MEI_ID))

sid_8 = mk(MEI_ID, 8, settled=False)
st, out = settle(sid_8, "none", 0)
check("D4 VIP 期间按原价结账会被拦（会员不该多付钱）", "VIP_MUST_BE_APPLIED", err((st, out)))
check("D4 改回 VIP 折扣后正常结算", 200, settle(sid_8, "vip_month", 210, member=MEI_ID)[0])
add_day(day(8)); assert_book("D4", "D4 小梅第 13 次到店")

# 补挂：顾客开始计时时忘了输邮箱
sid_forget = mk(None, 7, settled=False)
st, out = rpc("link_timer_session_to_member", p_session_id=sid_forget, p_member_id=MEI_ID)
check("D5 未结算的散客单可以当场补挂到会员", 200, st)
check("D5 挂上后还没结算时，进度资格留空等结算", None, sess(sid_forget).get("reward_eligible"))
st, out = settle(sid_forget, "vip_month", 210, member=MEI_ID)
check("D5 补挂后结算成功（此时 VIP 生效，按 85 折收）", 200, st)
add_day(day(7)); assert_book("D5", "D5 小梅第 14 次到店")

sid_past = mk(None, 30, settled=True)
st, out = rpc("link_timer_session_to_member", p_session_id=sid_past, p_member_id=MEI_ID)
check("D6 已经结算的散客单事后也能补挂", 200, st)
check("D6 补挂只加累计到店，不加奖励进度", False, sess(sid_past).get("reward_eligible"))
check("D6 补挂不动已收的金额", "13.99", sess(sid_past).get("actual_amount_gbp"))
add_day(day(30), "life"); assert_book("D6", "D6 补挂后累计 15 次 / 进度 14 次")
st, out = rpc("link_timer_session_to_member", p_session_id=sid_past, p_member_id=QIANG_ID)
check("D6 已经归属小梅的单不能再改挂给阿强", "SESSION_ALREADY_LINKED", err((st, out)))

# VIP 还生效中，这些单同样按 85 折（也顺便压一压「VIP 期间连续来店」这条路径）
for n in (6, 5, 4, 3, 2, 1):
    sid = mk(MEI_ID, n, settled=False)
    st, out = settle(sid, "vip_month", 210, member=MEI_ID)
    assert st == 200, (n, st, out)
    add_day(day(n))
assert_book("D7", "D7 小梅第 20 次到店")
check("D7 满 20 次解锁第二轮 VIP 月卡",
      sorted([(2, "TWO_POUND"), (2, "FIVE_POUND"), (2, "FRIEND_10_OFF"), (2, "PERSONAL_15_OFF"),
              (2, "VIP_MONTH"), (1, "FIVE_POUND"), (1, "FRIEND_10_OFF"), (1, "PERSONAL_15_OFF"),
              (1, "TWO_POUND"), (1, "VIP_MONTH")]), reward_set(MEI_ID))
st, ben = sel("member_benefits", f"select=benefit_id,reward_id&member_id=eq.{MEI_ID}"
                                  f"&activated_on=is.null")
VIP2_REWARD = (ben or [{}])[0].get("reward_id")
st, out = rpc("activate_member_vip", p_reward_id=VIP2_REWARD, p_activated_by="演练店员")
check("D8 手上还有一张生效中的月卡时，第二张激活会被拦", "VIP_ALREADY_ACTIVE", err((st, out)))

req("PATCH", f"/rest/v1/member_benefits?benefit_id=eq.{VIP1_BENEFIT}",
    {"activated_on": str(D - timedelta(days=40)), "expires_on": str(D - timedelta(days=11)),
     "activated_at": NOW.isoformat(), "activated_by": "演练店员"})
check("D9 第一张放到 40 天前后，月卡不再生效",
      False, rpc("member_vip_active", p_member_id=MEI_ID, p_at=noon(D))[1])
st, out = rpc("activate_member_vip", p_reward_id=VIP2_REWARD, p_activated_by="演练店员")
check("D9 旧的过期后，第二张可以激活", 200, st)

# ═══ E. 顾客自己的手机上看到什么（走真实接口）══════════════════════════════
st, raw = api("/api/member/dashboard", {"email": MEI})
check("E1 会员页能打开", 200, st)
d = (raw or {}).get("dashboard") or {}
check("E1 会员页显示的累计到店 = 21", 21, d.get("lifetime_visits"))
check("E1 会员页显示的奖励进度 = 20", 20, d.get("reward_progress"))
check("E1 会员页显示 10 张奖励", 10, len(d.get("rewards") or []))
check("E1 会员页显示月卡生效至第二张的到期日", str(D + timedelta(days=29)),
      (d.get("vip") or {}).get("active_expires_on"))
check("E1 最近到店按日期倒序、最新一条是今天", str(D), (d.get("visit_history") or [{}])[0].get("visit_date"))
vip_rows = [r for r in (d.get("rewards") or []) if r["reward"]["reward_type"] == "VIP_MONTH"]
check("E1 两张月卡都带回权益日期，页面才能显示「生效中 / 已结束」",
      True, all(r.get("benefit") and r["benefit"].get("expires_on") for r in vip_rows))
st, raw = api("/api/member/dashboard", {"email": MEI, "visitLimit": 100})
d = (raw or {}).get("dashboard") or {}
st, settled_rows = sel("timer_sessions",
                       f"select=session_id&member_id=eq.{MEI_ID}&is_settled=is.true")
check("E1 「最近到店」列表条数 = 库里的会员单数（按次，不按天）",
      len(settled_rows or []), len(d.get("visit_history") or []))
note("E1 口径差别（已知，非缺陷要确认）",
     f"同一天两次：列表 {len(d.get('visit_history') or [])} 条（按次），"
     f"顶部「累计到店」{d.get('lifetime_visits')} 次（按天去重）")

st, out = api("/api/member/lookup", {"email": "nobody.here@tangdouren.test"})
check("E2 没注册过的邮箱登录 → 提示还不是会员", 404, st)
st, out = api("/api/member/lookup", {"email": MEI})
check("E2 小梅的邮箱登录 → 认得出来", 200, st)

req("PATCH", f"/rest/v1/members?member_id=eq.{MEI_ID}", {"is_active": False})
st, out = api("/api/member/lookup", {"email": MEI})
check("E3 退会之后不能再用邮箱登录", 403, st)
st, out = api("/api/member/dashboard", {"email": MEI})
note("E3 退会后会员页接口", f"HTTP {st}（{str(out)[:60]}）—— 与登录接口不一致，记录下来")
req("PATCH", f"/rest/v1/members?member_id=eq.{MEI_ID}", {"is_active": True})

# ── 汇总 ────────────────────────────────────────────────────────────────────
print()
print("-" * 100)
print(f"{'结果':<6}{'场景':<58}{'期望':<26}实际")
print("-" * 100)
for scene, exp, act, ok in STEPS:
    flag = "（记录）" if ok is None else ("通过" if ok else "不通过")
    print(f"{flag:<6}{scene:<58}{exp[:24]:<26}{act[:30]}")
print("-" * 100)
passed = sum(1 for s in STEPS if s[3])
failed = [s for s in STEPS if s[3] is False]
print(f"通过 {passed}/{sum(1 for s in STEPS if s[3] is not None)}")
if failed:
    print("\n没过的场景：")
    for scene, exp, act, _ in failed:
        print(f"  - {scene}：期望 {exp}，实际 {act}")

# ── 收尾：把演练数据清掉，不给后面的人留麻烦 ───────────────────────────────
if KEEP:
    print("\nKEEP=1：演练数据留在库里（小梅 member_id =", MEI_ID, "）")
else:
    wipe_all()
    print("\n演练数据已清理，测试库里不留痕迹。")
