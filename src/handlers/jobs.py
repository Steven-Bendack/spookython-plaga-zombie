"""Step Functions steps for big Monte Carlo jobs (Jury Mode, decision map).

    plan      -> writes the chunk tasks to S3; the Distributed Map reads them
    (map)     -> one worker Lambda per task, results written to S3 by the Map
    aggregate -> merges the results and writes jobs/<id>/report.json
"""
from __future__ import annotations

import json
import os

import boto3

from engine.config import SimConfig
from engine.decision_map import decision_map_jobs, decision_map_report
from engine.jury import jury_jobs, jury_points, jury_report, sample_conditions
from engine.montecarlo import merge_many, plan_many

_s3 = boto3.client("s3")
BUCKET = os.environ.get("RESULTS_BUCKET", "")
JURY_RUNS = 12
MAP_RUNS = 20
JURY_SEED = 31


def plan(event, _context):
    job_id, kind = event["job_id"], event["kind"]
    base = SimConfig.from_dict(event["config"])
    if kind == "jury":
        conditions = sample_conditions(event["points"], JURY_SEED)
        jobs, runs = jury_jobs(base, conditions, JURY_RUNS), JURY_RUNS
    else:
        conditions = None
        jobs, runs = decision_map_jobs(base, MAP_RUNS), MAP_RUNS
    tasks, merge_plan = plan_many(jobs, chunk_runs=runs)
    _put(f"jobs/{job_id}/tasks.json", tasks)
    _put(f"jobs/{job_id}/plan.json", {"kind": kind, "config": base.to_dict(), "plan": merge_plan,
                                      "conditions": conditions, "runs": runs})
    return {"job_id": job_id, "bucket": BUCKET, "tasks_key": f"jobs/{job_id}/tasks.json",
            "tasks": len(tasks)}


def aggregate(event, _context):
    job_id = event["job_id"]
    meta = _get(f"jobs/{job_id}/plan.json")
    results = []
    manifest = _get(event["map_result"]["ResultWriterDetails"]["Key"])
    for entry in manifest["ResultFiles"].get("SUCCEEDED", []):
        for item in _get(entry["Key"]):
            results.append(json.loads(item["Output"]))
    merged = merge_many(meta["plan"], results)
    base = SimConfig.from_dict(meta["config"])
    if meta["kind"] == "jury":
        points = jury_points(base, meta["conditions"], "ring_hubs", merged)
        report = jury_report(points, "ring_hubs", meta["runs"], JURY_SEED)
    else:
        report = decision_map_report(base, meta["runs"], merged)
    _put(f"jobs/{job_id}/report.json", report)
    return {"job_id": job_id, "report_key": f"jobs/{job_id}/report.json"}


def _put(key: str, data) -> None:
    _s3.put_object(Bucket=BUCKET, Key=key, Body=json.dumps(data).encode(),
                   ContentType="application/json")


def _get(key: str):
    return json.loads(_s3.get_object(Bucket=BUCKET, Key=key)["Body"].read())
