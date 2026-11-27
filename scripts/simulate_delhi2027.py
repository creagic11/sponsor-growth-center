"""Build data/delhi2027.json: a SIMULATED live-plan workspace for the Task 1 strategy
(Delhi, DU host college, April 2027, Challenge B sponsorship).

Everything here is synthetic and labelled so in the app. The plan numbers (routes, bets,
properties, prices, budgets, hours, gates, cash path) are copied from the Task 1 content pack;
the week-4 pipeline is an invented but deliberately mixed picture so the dashboard and the
AI analyst have real decisions to make (one bet to stop, two to change, cash slightly behind).
Deterministic: same output every run.
"""
import json, random
from datetime import date, datetime, timedelta

random.seed(2027)
EVENT_START = "2027-04-09T10:00:00"
WEEK1 = date(2027, 1, 30)          # week k ends on WEEK1 + 7k - 1; end of week 4 = 26 Feb = T-42
SIM_TODAY = "2027-02-26"

def d(week, dow=0, hour=11, minute=0):
    x = WEEK1 + timedelta(days=(week - 1) * 7 + dow)
    return datetime(x.year, x.month, x.day, hour, minute).strftime("%Y-%m-%dT%H:%M:%S")

team = {
    "T11": ("Aanya Mehra", "Commercial lead"), "T12": ("Kabir Sethi", "Account owner A"), "T13": ("Ishita Rao", "Activation lead"),
    "T14": ("Rohan Bajaj", "Content lead"), "T15": ("Meher Gill", "Campus lead"), "T16": ("Dev Malhotra", "Measurement lead"), "T17": ("Sara Khan", "Finance liaison"),
}
campaigns = [
    dict(campaign_name="Warm introductions", channel="introduction", objective="Alumni, faculty and creator referrals to named budget owners",
         audience="Brands introduced by alumni, faculty and creators", owner_id="T11", sponsor_campaign_id="R1", budget_inr=35000, spend_inr=11000,
         plan=dict(accounts=30, conversations=20, proposals=14, wins=7, signed_inr=1250000)),
    dict(campaign_name="Sponsor-interest page (inbound)", channel="web_inbound", objective="Capture and qualify inbound sponsor enquiries",
         audience="Brands submitting the sponsor-interest page", owner_id="T12", sponsor_campaign_id="R2", budget_inr=30000, spend_inr=12000,
         plan=dict(accounts=20, conversations=12, proposals=8, wins=5, signed_inr=700000, gate=dict(metric="inbound_submissions", min=8, week=4, label="Inbound enquiries", action="Move 20 pod hours to warm asks."))),
    dict(campaign_name="Evidence-led: repeat fest sponsors", channel="email", objective="Tailored proposals to brands that sponsored Delhi fests before",
         audience="Brands seen on Mecca, Crossroads, Confluence and Tempest sponsor lists", owner_id="T14", sponsor_campaign_id="R3", budget_inr=30000, spend_inr=9000,
         plan=dict(accounts=60, conversations=14, proposals=6, wins=2, signed_inr=250000)),
    dict(campaign_name="Local and regional", channel="in_person", objective="Visits to cafés, retail and regional brands near the campus",
         audience="Local and regional businesses in the North Campus and South Delhi catchment", owner_id="T15", sponsor_campaign_id="R4", budget_inr=25000, spend_inr=6000,
         plan=dict(accounts=40, conversations=16, proposals=8, wins=4, signed_inr=200000)),
]
for c in campaigns:
    c.update(owner_name=team[c["owner_id"]][0], planned_start_at=d(1, 0, 9), planned_end_at="2027-03-19T18:00:00", created_at=d(1, 0, 8), status="active")

domains = [("Food, beverage, snacks", 22), ("Beauty, personal care", 20), ("Fashion, lifestyle", 12), ("Consumer tech and devices", 14), ("Gaming, sports, entertainment", 10),
           ("Banking, fintech, payments", 12), ("Education, test prep, careers", 14), ("Professional services, employers", 10), ("Mobility, auto", 12), ("Media, music, OTT", 10),
           ("Health, nutrition, wellness", 8), ("Local services, cafés, retail", 6)]
stems = ["Saffron", "Indus", "Monsoon", "Peepal", "Lotus", "Yamuna", "Banyan", "Kesar", "Neem", "Chinar", "Amber", "Tulsi", "Coral", "Jasmine", "Teal", "Vetiver", "Garnet", "Mango", "Cobalt", "Juniper", "Marigold", "Pista"]
suffix = {"Food, beverage, snacks": ["Foods", "Beverages", "Snacks"], "Beauty, personal care": ["Beauty", "Care", "Botanics"], "Fashion, lifestyle": ["Threads", "Label"],
          "Consumer tech and devices": ["Devices", "Audio"], "Gaming, sports, entertainment": ["Arena", "Sports"], "Banking, fintech, payments": ["Pay", "Finance"],
          "Education, test prep, careers": ["Learning", "Academy"], "Professional services, employers": ["Advisory", "Partners"], "Mobility, auto": ["Motors", "Rides"],
          "Media, music, OTT": ["Media", "Music"], "Health, nutrition, wellness": ["Wellness", "Nutrition"], "Local services, cafés, retail": ["Café", "Store"]}

# Named accounts that carry the week-4 story (route, domain, bet, property, stage path)
named = [
    # brand, domain, route, owner, bet, property, value, stage path [(stage, week, dow)], support
    ("Brightline Capital", "Banking, fintech, payments", "R1", "T11", "TITLE", "P01", 500000, [("prospecting", 2, 1), ("contacted", 2, 4), ("proposal_sent", 3, 2), ("negotiating", 4, 3)], 400000),
    ("Northstar Careers", "Education, test prep, careers", "R1", "T12", "B1", "P11", 100000, [("prospecting", 1, 3), ("contacted", 2, 0), ("proposal_sent", 2, 5), ("partner_confirmed", 3, 1)], None),
    ("Lumiere Beauty", "Beauty, personal care", "R1", "T14", "B3", "P06", 150000, [("prospecting", 2, 0), ("contacted", 2, 3), ("proposal_sent", 3, 3), ("partner_confirmed", 4, 0)], None),
    ("Keystone Advisory", "Professional services, employers", "R1", "T12", "B1", "P12", 100000, [("prospecting", 2, 2), ("contacted", 3, 1), ("proposal_sent", 4, 1)], None),
    ("Ascend Talent Partners", "Professional services, employers", "R1", "T12", "B1", "P02", 300000, [("prospecting", 3, 0), ("contacted", 3, 3), ("proposal_sent", 4, 2)], 250000),
    ("Pixelcraft Devices", "Consumer tech and devices", "R1", "T14", "B3", "P07", 150000, [("prospecting", 2, 4), ("contacted", 3, 2), ("proposal_sent", 4, 0), ("negotiating", 4, 4)], None),
    ("Kulhad & Co", "Food, beverage, snacks", "R1", "T15", "B4", "P08", 150000, [("prospecting", 3, 1), ("contacted", 3, 5), ("proposal_sent", 4, 3)], None),
    ("Meridian Motors", "Mobility, auto", "R1", "T11", "TITLE", None, 500000, [("prospecting", 3, 2), ("contacted", 4, 1)], None),
    ("Frostbite Beverages", "Food, beverage, snacks", "R1", "T13", "B2", "P03", 300000, [("prospecting", 2, 3), ("contacted", 3, 0)], 250000),
    ("CoolBreeze Wellness", "Health, nutrition, wellness", "R1", "T13", "B2", "P05", 150000, [("prospecting", 4, 0)], None),
    ("Campus Bites", "Local services, cafés, retail", "R2", "T12", "B4", "P22", 50000, [("prospecting", 1, 4), ("contacted", 2, 1), ("proposal_sent", 2, 4), ("partner_confirmed", 3, 0)], None),
    ("Respawn Arena", "Gaming, sports, entertainment", "R2", "T12", "B1", "P14", 100000, [("prospecting", 3, 4), ("contacted", 4, 2)], None),
    ("VitalSip Nutrition", "Health, nutrition, wellness", "R2", "T16", "B5", "P17", 100000, [("prospecting", 4, 1), ("contacted", 4, 4)], None),
    ("Ledgerly Pay", "Banking, fintech, payments", "R3", "T14", "B1", "P13", 100000, [("prospecting", 2, 1), ("contacted", 3, 0), ("proposal_sent", 4, 2)], None),
    ("Glide Rides", "Mobility, auto", "R3", "T14", "B2", None, 150000, [("prospecting", 2, 0), ("contacted", 2, 4), ("lost", 3, 3)], None),
    ("Brew Lane Café", "Local services, cafés, retail", "R4", "T15", "B4", "P23", 50000, [("prospecting", 2, 2), ("contacted", 3, 1), ("proposal_sent", 3, 4), ("partner_confirmed", 4, 5)], None),
    ("PedalWorks Saket", "Local services, cafés, retail", "R4", "T15", "B3", "P21", 50000, [("prospecting", 3, 0), ("contacted", 3, 4), ("proposal_sent", 4, 3)], None),
]
named_domain_count = {}
for n in named: named_domain_count[n[1]] = named_domain_count.get(n[1], 0) + 1

brands, contacts, interactions, qual, opps, opp_hist = [], [], [], [], [], []
bid = 0; iid = 0; aid = 0; hid = 0; qid = 0
first = ["Aarav", "Diya", "Ishaan", "Kavya", "Neel", "Riya", "Sana", "Vihaan", "Zoya", "Arjun", "Meera", "Tara", "Yash", "Anika", "Kabir", "Nisha"]
last = ["Sharma", "Kapoor", "Mehta", "Bhatia", "Malhotra", "Arora", "Chawla", "Khanna", "Suri", "Gill", "Bedi", "Sethi"]
titles = ["Brand Marketing Lead", "Partnerships Manager", "Campus Marketing Manager", "HR and Campus Recruiting Lead", "Founder"]

def new_brand(name, domain, route, owner, created):
    global bid
    bid += 1
    b = dict(brand_name=name, industry=domain, domain=domain, owner_name=team[owner][0], created_at=created, brand_id=f"D{bid:03d}", owner_id=owner, route_id=route)
    brands.append(b)
    c = dict(contact_name=f"{random.choice(first)} {random.choice(last)}", job_title=random.choice(titles), brand_name=name, created_at=created, contact_id=f"DC{bid:03d}", brand_id=b["brand_id"])
    contacts.append(c)
    return b, c

def ev(b, c, route, et, outcome, ts, attempt, origin=None, summary=None):
    global iid
    iid += 1
    camp = next(x for x in campaigns if x["sponsor_campaign_id"] == route)
    rid = f"DI{iid:04d}"
    interactions.append(dict(brand_name=b["brand_name"], contact_name=c["contact_name"], campaign_name=camp["campaign_name"], channel=camp["channel"], event_type=et, outcome=outcome,
                             summary=summary or "Simulated event.", occurred_at=ts, interaction_id=rid, attempt_id=attempt, origin_interaction_id=origin, brand_id=b["brand_id"],
                             contact_id=c["contact_id"], sponsor_campaign_id=route, owner_id=camp["owner_id"]))
    return rid

def qv(b, status, ts, route, reason):
    global qid
    qid += 1
    camp = next(x for x in campaigns if x["sponsor_campaign_id"] == route)
    qual.append(dict(brand_name=b["brand_name"], qualification_status=status, reason=reason, source_campaign_name=camp["campaign_name"], effective_at=ts, history_id=f"DQ{qid:04d}", brand_id=b["brand_id"], sponsor_campaign_id=route))

def touch(b, c, route, week, conversation, meeting):
    """Root event, then a response and meeting when this brand is a conversation."""
    global aid
    aid += 1
    att = f"DA{aid:04d}"
    root_type = {"R1": ("introduction_received", "introduced"), "R2": ("web_inbound", "interest_submitted"), "R3": ("outreach_sent", "sent"), "R4": ("outreach_sent", "sent")}[route]
    dow = random.randint(0, 4)
    t0 = d(week, dow, 10)
    root = ev(b, c, route, root_type[0], root_type[1], t0, att, None, "Simulated first touch.")
    if route == "R3": ev(b, c, route, "delivered", "delivered", d(week, dow, 10, 5), att, root, "Delivery confirmed; not a response.")
    qv(b, "unreviewed", d(week, dow, 9), route, "Added to the account list.")
    if conversation:
        rt = d(week, min(dow + 1, 6), 12)
        ev(b, c, route, "replied", "positive" if conversation != "neutral" else "neutral", rt, att, root, "Contact replied.")
        qv(b, "engaged", d(week, min(dow + 1, 6), 12, 20), route, "Contact responded; fit not yet confirmed.")
        if meeting:
            ev(b, c, route, "meeting_booked", "scheduled", d(week, min(dow + 2, 6), 15), att, root, "Discovery call booked.")
            ev(b, c, route, "meeting_held", "attended", d(min(week + 1, 4), min(dow, 4), 15), att, root, "Discovery call held.")
    return t0

def stage_ts(week, dow): return d(week, dow, 12)

# 1) named accounts with deals
oid = 0
for (name, dom, route, owner, bet, prop, value, path, nego_value) in named:
    first_week = path[0][1]
    b, c = new_brand(name, dom, route, owner, d(max(first_week - 1, 1), 0, 8))
    touch(b, c, route, first_week, True, True)
    oid += 1
    o = dict(opportunity_name=f"{name} festival partnership", brand_name=name, primary_contact_name=c["contact_name"], originating_campaign_name=next(x for x in campaigns if x["sponsor_campaign_id"] == route)["campaign_name"],
             support_type="cash", created_at=stage_ts(*path[0][1:]), opportunity_id=f"DO{oid:03d}", brand_id=b["brand_id"], primary_contact_id=c["contact_id"], sponsor_campaign_id=route, bet_id=bet, property_id=prop)
    opps.append(o)
    for st, wk, dow in path:
        hid += 1
        val = nego_value if (st in ("negotiating", "partner_confirmed") and nego_value) else value
        if st == "proposal_sent" and nego_value and bet == "B1": val = nego_value
        opp_hist.append(dict(opportunity_name=o["opportunity_name"], brand_name=name, stage=st, proposed_value_inr=val, confirmed_value_inr=val if st == "partner_confirmed" else 0,
                             owner_name=team[owner][0], effective_at=stage_ts(wk, dow), history_id=f"DH{hid:04d}", opportunity_id=o["opportunity_id"], brand_id=b["brand_id"], owner_id=owner))
    last_stage = path[-1][0]
    if last_stage in ("proposal_sent", "negotiating", "partner_confirmed"): qv(b, "qualified", stage_ts(path[1][1], path[1][2]) if len(path) > 1 else stage_ts(*path[0][1:]), route, "Budget owner, objective and payment date confirmed.")
    if last_stage == "lost": qv(b, "unqualified", stage_ts(path[-1][1], path[-1][2]), route, "No budget before T-21.")

# 2) remaining accounts per route so totals match the plan's account lists at week 4
targets_now = {"R1": dict(accounts=30, conv=14, meet=11), "R2": dict(accounts=6, conv=5, meet=4), "R3": dict(accounts=60, conv=4, meet=3), "R4": dict(accounts=40, conv=6, meet=4)}
have = {r: dict(accounts=0, conv=0, meet=0) for r in targets_now}
for n in named:
    have[n[2]]["accounts"] += 1; have[n[2]]["conv"] += 1; have[n[2]]["meet"] += 1
domain_pool = []
for dom, cnt in domains:
    domain_pool += [dom] * max(cnt - named_domain_count.get(dom, 0), 0)
random.shuffle(domain_pool)
used_names = {n[0] for n in named}
for route, tgt in targets_now.items():
    need = tgt["accounts"] - have[route]["accounts"]
    conv_left = max(tgt["conv"] - have[route]["conv"], 0); meet_left = max(tgt["meet"] - have[route]["meet"], 0)
    for k in range(need):
        dom = domain_pool.pop() if domain_pool else "Local services, cafés, retail"
        if route == "R4": dom = random.choice(["Local services, cafés, retail", "Food, beverage, snacks", "Health, nutrition, wellness", "Fashion, lifestyle", "Mobility, auto"])
        while True:
            nm = f"{random.choice(stems)} {random.choice(suffix[dom])}"
            if nm not in used_names: used_names.add(nm); break
        week = {"R1": random.choice([1, 1, 2, 2, 3, 3, 4]), "R2": random.choice([2, 3, 3, 4]), "R3": random.choice([1, 2, 2, 3, 3, 4]), "R4": random.choice([1, 2, 3, 3, 4, 4])}[route]
        owner = next(x for x in campaigns if x["sponsor_campaign_id"] == route)["owner_id"]
        b, c = new_brand(nm, dom, route, owner, d(max(week - 1, 1), 0, 8))
        conv = None; meet = False
        if conv_left > 0: conv = "positive" if random.random() < 0.7 else "neutral"; conv_left -= 1
        if conv and meet_left > 0: meet = True; meet_left -= 1
        touch(b, c, route, week, conv, meet)
        if route == "R3" and not conv and random.random() < 0.35:  # follow-up attempt, no reply
            aid_ = f"DA{9000 + bid:04d}"
            r = ev(b, c, route, "outreach_sent", "sent", d(min(week + 1, 4), 2, 10), aid_, None, "Follow-up in the same conversation.")
            ev(b, c, route, "delivered", "delivered", d(min(week + 1, 4), 2, 10, 5), aid_, r, "Delivery confirmed.")

properties = []
tier_price = {"title": 500000, "signature": 300000, "category": 150000, "competition": 100000, "supporting": 50000}
tier_base = {"title": 400000, "signature": 250000, "category": 150000, "competition": 100000, "supporting": 50000}
spec = [("P01", "title", "TITLE", "Title association"), ("P02", "signature", "B1", "Talent-to-Stage signature"), ("P03", "signature", "B2", "April Comfort and Access signature"),
        ("P04", "signature", None, "Unallocated signature (stretch)"), ("P05", "category", "B2", "Comfort category: hydration"), ("P06", "category", "B3", "Creator Studio category A"),
        ("P07", "category", "B3", "Creator Studio category B"), ("P08", "category", "B4", "Culture Circuit category"), ("P09", "category", None, "Unallocated category (stretch)"),
        ("P10", "category", None, "Unallocated category"), ("P11", "competition", "B1", "Talent-to-Stage challenge 1"), ("P12", "competition", "B1", "Talent-to-Stage challenge 2"),
        ("P13", "competition", "B1", "Talent-to-Stage challenge 3"), ("P14", "competition", "B1", "Talent-to-Stage challenge 4"), ("P15", "competition", "B3", "Creator Studio reel contest"),
        ("P16", "competition", "B4", "Culture Circuit qualifier"), ("P17", "competition", "B5", "Discovery Trail challenge"), ("P18", "competition", None, "Unallocated competition (stretch)"),
        ("P19", "competition", None, "Unallocated competition (stretch)"), ("P20", "competition", None, "Unallocated competition"), ("P21", "supporting", "B3", "Creator Studio supporting"),
        ("P22", "supporting", "B4", "Culture Circuit supporting A"), ("P23", "supporting", "B4", "Culture Circuit supporting B"), ("P24", "supporting", "B5", "Discovery Trail supporting")]
for pid, tier, bet, label in spec:
    properties.append(dict(property_id=pid, tier=tier, bet_id=bet, name=label, list_price_inr=tier_price[tier], base_realised_inr=tier_base[tier]))

# Task 1 base plan: 18 properties = ₹24.0L signed
plan_deals = [dict(tier="title", bet_id="TITLE", value_inr=400000)]
plan_deals += [dict(tier="competition", bet_id="B1", value_inr=100000)] * 4 + [dict(tier="signature", bet_id="B1", value_inr=250000)]
plan_deals += [dict(tier="signature", bet_id="B2", value_inr=250000), dict(tier="category", bet_id="B2", value_inr=150000)]
plan_deals += [dict(tier="category", bet_id="B3", value_inr=150000)] * 2 + [dict(tier="competition", bet_id="B3", value_inr=100000), dict(tier="supporting", bet_id="B3", value_inr=50000)]
plan_deals += [dict(tier="category", bet_id="B4", value_inr=150000), dict(tier="competition", bet_id="B4", value_inr=100000)] + [dict(tier="supporting", bet_id="B4", value_inr=50000)] * 2
plan_deals += [dict(tier="competition", bet_id="B5", value_inr=100000), dict(tier="supporting", bet_id="B5", value_inr=50000)]
assert sum(x["value_inr"] for x in plan_deals) == 2400000 and len(plan_deals) == 18

bets = [
    dict(bet_id="TITLE", rank=0, name="Title association (anchor)", owner_name="Aanya Mehra", gate_type="title", plan_signed_inr=400000, acq_budget_inr=20000, fulfil_budget_inr=40000,
         hours_planned=80, hours_logged=34, spend_inr=6000, status="active", signals=dict(qualified_buyers=2, proposal_week=3),
         gate=dict(proposal_week=3, change_week=4, sign_week=5, stop_week=6, text="Scale: qualified buyer at proposal by wk 3 and signed by wk 5. Change: no proposal by end wk 4. Stop: no signature by end wk 6.", action="Split into two signature packages if it slips.")),
    dict(bet_id="B1", rank=1, name="Talent-to-Stage Challenge", owner_name="Kabir Sethi", gate_type="talent", plan_signed_inr=650000, acq_budget_inr=25000, fulfil_budget_inr=80000,
         hours_planned=260, hours_logged=96, spend_inr=9000, status="active", signals=dict(qualified_calls=5),
         gate=dict(calls_week=4, scale_calls=4, stop_calls_below=2, scale_signed_inr=300000, signed_week=6, text="Scale: 4+ qualified calls by wk 4 and ₹3L signed by wk 6. Change: 2–3 calls, or calls with no proposal by wk 5. Stop: under 2 calls by wk 4.", action="Reframe brief; add a second society.")),
    dict(bet_id="B2", rank=2, name="April Comfort and Access Partner", owner_name="Ishita Rao", gate_type="comfort", plan_signed_inr=400000, acq_budget_inr=20000, fulfil_budget_inr=70000,
         fulfil_quote_inr=168000, hours_planned=180, hours_logged=58, spend_inr=4000, status="active", signals=dict(quote_received_week=3),
         gate=dict(quote_week=2, scale_quote_max_inr=70000, stop_quote_above_inr=80000, reference_price_inr=400000, proposal_week=5, scale_proposals=3, text="Scale: quote ≤ ₹0.70L (17.5% of ₹4.0L) and 3+ proposals by wk 5. Change: quote ₹0.70–0.80L, use contingency. Stop: quote > ₹0.80L, or no proposal by wk 5.", action="Shrink scope; safety stays funded, unsponsored.")),
    dict(bet_id="B3", rank=3, name="Campus Creator Studio", owner_name="Rohan Bajaj", gate_type="creator", plan_signed_inr=450000, acq_budget_inr=20000, fulfil_budget_inr=60000,
         hours_planned=200, hours_logged=71, spend_inr=7000, status="active", signals=dict(sample_reviewed=True, rights_cleared=False),
         gate=dict(proposal_week=5, scale_proposals=2, text="Scale: sample praised and 2+ proposals by wk 5. Change: interest but rights unclear. Stop: no proposal out by wk 5.", action="Re-scope to owned assets only.")),
    dict(bet_id="B4", rank=4, name="College Culture Circuit", owner_name="Meher Gill", gate_type="circuit", plan_signed_inr=350000, acq_budget_inr=20000, fulfil_budget_inr=30000,
         hours_planned=220, hours_logged=88, spend_inr=5000, status="active", signals=dict(societies_committed=2),
         gate=dict(societies_week=4, scale_signed_inr=200000, signed_week=7, text="Scale: 3 societies by wk 4 and ₹2L signed by wk 7. Change: exactly 2 societies by wk 4. Stop: 1 society or fewer by wk 4.", action="Host campus only.")),
    dict(bet_id="B5", rank=5, name="Discovery Trail", owner_name="Dev Malhotra", gate_type="trail", plan_signed_inr=150000, acq_budget_inr=15000, fulfil_budget_inr=20000,
         hours_planned=90, hours_logged=18, spend_inr=1000, status="active", signals=dict(rehearsal_date="2027-03-04", rehearsal_passed=None),
         gate=dict(text="Scale: wk 4 rehearsal meets promised throughput with consent. Change: throughput short. Stop: rehearsal fails or consent unworkable.", action="Drop; reallocate hours.")),
]

cash_path = [
    dict(week=4, label="End wk 4", signed_floor_inr=400000, conversations_floor=25, proposals_floor=12, derivation="Ramp: first signings from wk 4"),
    dict(week=5, label="End wk 5", signed_floor_inr=1000000, proposals_floor=36, derivation="Proposal cut-off for a 14-day close"),
    dict(week=6, label="End wk 6", signed_floor_inr=1600000, due_inr=600000, received_green_inr=570000, received_red_below_inr=500000, derivation="60% of ₹10L signed by T−35, 7-day lag"),
    dict(week=7, label="End wk 7 (signing closes)", signed_floor_inr=2400000, derivation="Last realistic signing (T−21)"),
    dict(week=8, label="End wk 8", signed_floor_inr=2400000, due_inr=2160000, received_green_inr=2040000, received_red_below_inr=1800000, derivation="Green = 94.4% of due = base 85%; red = 83.3% of due = downside 75%"),
    dict(week=10, label="Event start", signed_floor_inr=2400000, received_green_inr=2040000, received_red_below_inr=1800000, derivation="Same bands; last 10% is post-event"),
]

payments = [
    dict(payment_id="PY001", opportunity_id="DO002", brand_name="Northstar Careers", instalment="60% on signing", amount_inr=60000, issued_at=d(3, 1, 16), due_date="2027-02-22", paid_at="2027-02-22T15:00:00", status="paid"),
    dict(payment_id="PY002", opportunity_id="DO011", brand_name="Campus Bites", instalment="60% on signing", amount_inr=30000, issued_at=d(3, 0, 16), due_date="2027-02-20", paid_at=None, status="issued"),
    dict(payment_id="PY003", opportunity_id="DO003", brand_name="Lumiere Beauty", instalment="60% on signing", amount_inr=90000, issued_at=d(4, 0, 16), due_date="2027-03-01", paid_at=None, status="issued"),
    dict(payment_id="PY004", opportunity_id="DO016", brand_name="Brew Lane Café", instalment="60% on signing", amount_inr=30000, issued_at=d(4, 5, 16), due_date="2027-03-04", paid_at=None, status="issued"),
]

tasks = [
    ("Chase Campus Bites first invoice (₹0.30L, due 20 Feb)", "Sara Khan", "2027-02-27", "todo", "high", "payment", "PY002", "Campus Bites invoice"),
    ("Brightline Capital: send revised title terms at ₹4.0L", "Aanya Mehra", "2027-03-01", "in_progress", "high", "opportunity", "DO001", "Brightline Capital"),
    ("Prepare two-signature fallback in case the title slips", "Aanya Mehra", "2027-03-03", "todo", "medium", "bet", "TITLE", "Title association"),
    ("Comfort Partner: get a second delivery quote under the ₹0.80L cap", "Ishita Rao", "2027-03-02", "in_progress", "high", "bet", "B2", "Comfort Partner"),
    ("Creator Studio: confirm music and likeness rights", "Rohan Bajaj", "2027-03-01", "blocked", "high", "bet", "B3", "Creator Studio"),
    ("Recruit a third society for the Culture Circuit", "Meher Gill", "2027-02-28", "in_progress", "high", "bet", "B4", "Culture Circuit"),
    ("Run the Discovery Trail rehearsal (throughput and consent)", "Dev Malhotra", "2027-03-04", "todo", "medium", "bet", "B5", "Discovery Trail"),
    ("Push the sponsor-interest page through 30 society handles", "Kabir Sethi", "2027-02-24", "todo", "high", "campaign", "R2", "Sponsor-interest page"),
    ("Follow up Keystone Advisory proposal", "Kabir Sethi", "2027-02-27", "todo", "medium", "opportunity", "DO004", "Keystone Advisory"),
    ("Alumni newsletter: founding-partner ask", "Kabir Sethi", "2027-03-02", "todo", "medium", "campaign", "R1", "Warm introductions"),
    ("Monday dashboard review: gates and cash bands", "Aanya Mehra", "2027-03-01", "todo", "medium", None, None, None),
    ("Calendar scan: rival DU fest dates in April", "Aanya Mehra", "2027-02-05", "done", "medium", None, None, None),
    ("Commercial charter approved by the principal", "Aanya Mehra", "2027-02-06", "done", "high", None, None, None),
    ("Rights register: log all 24 properties", "Dev Malhotra", "2027-02-10", "done", "medium", None, None, None),
]
task_rows = []
for i, (title, owner, due, status, prio, ltype, lid, llabel) in enumerate(tasks, 1):
    task_rows.append(dict(task_id=f"TK{i:03d}", title=title, owner=owner, due_date=due, status=status, priority=prio, linked_type=ltype, linked_id=lid, linked_label=llabel,
                          created_at="2027-02-01T09:00:00" if status == "done" else "2027-02-22T09:00:00", source="seed"))

out = dict(
    workspace=dict(id="dl27", name="Delhi Fest 2027 · live plan (simulated)", kind="simulated",
                   description="SIMULATED week-4 snapshot of the Task 1 plan: Delhi, DU host college, festival 9–10 April 2027, Challenge B. Plan figures (routes, bets, prices, budgets, hours, gates, cash path) are copied from the Task 1 content pack; deals, people and brands are invented.",
                   default_as_of=SIM_TODAY),
    event=dict(event_name="Delhi Fest 2027 (DU host college)", history_start=d(1, 0, 0), history_end=SIM_TODAY + "T23:59:59", event_starts_at=EVENT_START, event_ends_at="2027-04-10T22:00:00",
               timezone="Asia/Kolkata", currency="INR", fictional=True),
    targets=[dict(effective_at=d(1, 0, 9), qualified_brands_goal=36, confirmed_partnerships_goal=18, signed_value_goal_inr=2400000, cash_goal_inr=2040000,
                  stretch_signed_value_goal_inr=3000000, stretch_cash_goal_inr=2700000, target_version="Committed base (Task 1)")],
    brands=brands, contacts=contacts, campaigns=campaigns, interactions=interactions, qualification=qual, opportunities=opps, opp_history=opp_hist, activations=[],
    payments=payments, tasks=task_rows,
    team=[dict(owner_id=k, name=v[0], role=v[1]) for k, v in team.items()],
    plan=dict(week1_start=WEEK1.isoformat(), weeks_total=10, base_signed_inr=2400000, stretch_signed_inr=3000000, last_year_confirmed_cash_inr=2000000,
              hours_total=1440, contingency_inr=80000,
              ramp=dict(conversations=[0.1, 0.2, 0.3, 25/62, 1, 1, 1, 1, 1, 1], proposals=[0, 0.05, 0.15, 12/36, 1, 1, 1, 1, 1, 1], signed=[0, 0, 0.05, 4/24, 10/24, 16/24, 1, 1, 1, 1]), bets=bets, properties=properties, plan_deals=plan_deals, cash_path=cash_path,
              payment_terms="60% on signing (due 7–10 days after), 30% by T−14, 10% after the event (ASSUMPTION)"),
    settings=dict(collection_rate=0.85),
)
json.dump(out, open("data/delhi2027.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("brands", len(brands), "interactions", len(interactions), "opps", len(opps))
