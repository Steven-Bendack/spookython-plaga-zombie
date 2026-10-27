"""AWS Lambda adapter for the public HTTP API (API Gateway HTTP API, payload v2).

Routes (CloudFront forwards /api/* here):
    GET  /api/meta              defaults, presets and city facts
    POST /api/simulate          tournament; chunks fan out to the worker Lambda
    POST /api/challenge         «¿Le ganas al comité?»: the player's plan vs the committee
    POST /api/report            mayor's report written by DeepSeek (template fallback)
    POST /api/jobs              start a big Monte Carlo job (Step Functions Distributed Map)
    GET  /api/jobs/{id}         job status and, when done, its report

The engine knows nothing about AWS: this file only translates HTTP <-> engine.
"""
from __future__ import annotations

import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import boto3

from engine.api import challenge, meta, simulate
from engine.config import SimConfig
from engine.mayor import mayor_report

_lambda = boto3.client("lambda")
_sfn = boto3.client("stepfunctions")
_s3 = boto3.client("s3")

WORKER = os.environ.get("WORKER_FUNCTION", "")
STATE_MACHINE = os.environ.get("STATE_MACHINE_ARN", "")
RESULTS_BUCKET = os.environ.get("RESULTS_BUCKET", "")
MAX_FANOUT = int(os.environ.get("MAX_FANOUT", "10"))
MAX_BODY = 16_384
MAX_INTERACTIVE_RUNS = int(os.environ.get("MAX_INTERACTIVE_RUNS", "200"))


def lambda_runner(tasks: list[dict]) -> list[dict]:
    """Run each chunk in its own worker Lambda, MAX_FANOUT at a time."""
    def invoke(task):
        res = _lambda.invoke(FunctionName=WORKER, Payload=json.dumps(task).encode())
        payload = json.loads(res["Payload"].read())
        if res.get("FunctionError"):
            raise RuntimeError(payload.get("errorMessage", "worker failed"))
        return payload

    with ThreadPoolExecutor(max_workers=MAX_FANOUT) as pool:
        return list(pool.map(invoke, tasks))


def handler(event, _context):
    method = event.get("requestContext", {}).get("http", {}).get("method", "GET")
    path = event.get("rawPath", "")
    try:
        if method == "GET" and path.endswith("/api/meta"):
            return _ok(meta())
        if method == "POST" and path.endswith("/api/simulate"):
            body = _body(event)
            body["runs"] = min(int(body.get("runs", 100)), MAX_INTERACTIVE_RUNS)
            return _ok(simulate(body, lambda_runner))
        if method == "POST" and path.endswith("/api/challenge"):
            body = _body(event)
            body["runs"] = min(int(body.get("runs", 100)), MAX_INTERACTIVE_RUNS)
            return _ok(challenge(body, lambda_runner))
        if method == "POST" and path.endswith("/api/report"):
            return _ok(mayor_report(_body(event)))
        if method == "POST" and path.endswith("/api/jobs"):
            return _ok(_start_job(_body(event)), status=202)
        if method == "GET" and "/api/jobs/" in path:
            return _ok(_job_status(path.rsplit("/", 1)[-1]))
    except (ValueError, TypeError, KeyError) as exc:
        return _error(400, f"Parámetros inválidos: {exc}")
    return _error(404, "Ruta no encontrada.")


def _start_job(body: dict) -> dict:
    kind = body.get("kind", "jury")
    if kind not in ("jury", "decision_map"):
        raise ValueError("kind debe ser 'jury' o 'decision_map'")
    job_id = uuid.uuid4().hex[:16]
    config = SimConfig.from_dict(body).to_dict()
    _sfn.start_execution(
        stateMachineArn=STATE_MACHINE, name=job_id,
        input=json.dumps({"job_id": job_id, "kind": kind, "config": config,
                          "points": int(min(max(body.get("points", 40), 8), 200))}),
    )
    return {"job_id": job_id, "status": "RUNNING"}


def _job_status(job_id: str) -> dict:
    if not job_id.isalnum():
        raise ValueError("id de trabajo inválido")
    arn = STATE_MACHINE.replace(":stateMachine:", ":execution:") + f":{job_id}"
    status = _sfn.describe_execution(executionArn=arn)["status"]
    out = {"job_id": job_id, "status": status}
    if status == "SUCCEEDED":
        obj = _s3.get_object(Bucket=RESULTS_BUCKET, Key=f"jobs/{job_id}/report.json")
        out["report"] = json.loads(obj["Body"].read())
    return out


def _body(event) -> dict:
    raw = event.get("body") or "{}"
    if len(raw) > MAX_BODY:
        raise ValueError("cuerpo demasiado grande")
    if event.get("isBase64Encoded"):
        import base64
        raw = base64.b64decode(raw).decode()
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("se esperaba un objeto JSON")
    return data


def _ok(data, status=200):
    return {"statusCode": status, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(data)}


def _error(status, message):
    return _ok({"error": message}, status)
