"""Convert the sponsor dataset workbook into data/campusfest2025.json.
Keeps every source row as-is (including import-retry duplicates); the engine deduplicates."""
import json, sys, math
import pandas as pd
src = sys.argv[1] if len(sys.argv) > 1 else "Sponsor Dataset.xlsx"
x = pd.ExcelFile(src)
sheets = {"Event":"event","Targets":"targets","Brands":"brands","Sponsor contacts":"contacts",
          "Sponsor campaigns":"campaigns","Sponsor interactions":"interactions",
          "Brand qualification":"qualification","Partner opportunities":"opportunities",
          "Opportunity history":"opp_history","Sponsor activations":"activations"}
def clean(v):
    if isinstance(v, pd.Timestamp): return v.strftime("%Y-%m-%dT%H:%M:%S")
    if v is None or (isinstance(v, float) and math.isnan(v)): return None
    if hasattr(v, "item"): v = v.item()
    if isinstance(v, float) and v.is_integer(): return int(v)
    return v
out = {"workspace":{"id":"cf25","name":"CampusFest 2025","kind":"source",
       "description":"Original sponsor dataset supplied with the assignment (fictional, 15 Jan to 20 Apr 2025). Every number here is FACT from the source unless marked.",
       "default_as_of":"2025-04-20"}}
for sh, key in sheets.items():
    df = x.parse(sh)
    out[key] = [{k: clean(v) for k, v in r.items()} for r in df.to_dict("records")]
out["event"] = out["event"][0]
out["readme"] = [{"topic":r[0],"text":r[1]} for r in x.parse("Read me").values.tolist()]
out["field_guide"] = [dict(zip(["table","field","type","meaning"], r)) for r in x.parse("Field guide").values.tolist()]
json.dump(out, open("data/campusfest2025.json","w"), indent=0, ensure_ascii=False)
print({k:len(v) for k,v in out.items() if isinstance(v,list)})
