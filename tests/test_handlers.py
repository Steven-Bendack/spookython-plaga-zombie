import json

import pytest

boto3 = pytest.importorskip("boto3")


@pytest.fixture()
def api(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from handlers import api as module
    from engine.montecarlo import serial_runner
    monkeypatch.setattr(module, "lambda_runner", serial_runner)
    return module


def _event(method, path, body=None):
    return {"requestContext": {"http": {"method": method}}, "rawPath": path,
            "body": json.dumps(body) if body is not None else None}


def test_meta_route(api):
    res = api.handler(_event("GET", "/api/meta"), None)
    assert res["statusCode"] == 200
    assert "defaults" in json.loads(res["body"])


def test_simulate_route_caps_runs(api, monkeypatch):
    monkeypatch.setattr(api, "MAX_INTERACTIVE_RUNS", 3)
    res = api.handler(_event("POST", "/api/simulate", {"runs": 999, "population": 2000, "days": 30}), None)
    body = json.loads(res["body"])
    assert res["statusCode"] == 200 and body["config"]["runs"] == 3


def test_challenge_route_caps_runs_and_rejects_bad_plans(api, monkeypatch):
    monkeypatch.setattr(api, "MAX_INTERACTIVE_RUNS", 3)
    body = {"runs": 999, "population": 2000, "days": 30, "plan": ["students"]}
    res = api.handler(_event("POST", "/api/challenge", body), None)
    assert res["statusCode"] == 200 and json.loads(res["body"])["config"]["runs"] == 3
    bad = api.handler(_event("POST", "/api/challenge", {**body, "plan": ["aliens"]}), None)
    assert bad["statusCode"] == 400


def test_bad_json_is_a_400(api):
    res = api.handler({"requestContext": {"http": {"method": "POST"}}, "rawPath": "/api/simulate",
                       "body": "[1, 2]"}, None)
    assert res["statusCode"] == 400


def test_unknown_route_is_a_404(api):
    assert api.handler(_event("GET", "/api/nope"), None)["statusCode"] == 404
