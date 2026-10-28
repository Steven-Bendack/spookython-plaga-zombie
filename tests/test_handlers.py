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


<<<<<<< Updated upstream
class _FakeLambda:
    """Throttles the first `fail` invokes, then echoes the task back."""

    def __init__(self, fail):
        self.fail, self.calls = fail, 0

    def invoke(self, FunctionName, Payload):
        import io
        from botocore.exceptions import ClientError
        self.calls += 1
        if self.calls <= self.fail:
            raise ClientError({"Error": {"Code": "TooManyRequestsException"}}, "Invoke")
        return {"Payload": io.BytesIO(Payload)}


def test_throttled_workers_are_retried(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from handlers import api
    fake = _FakeLambda(fail=2)
    monkeypatch.setattr(api, "_lambda", fake)
    monkeypatch.setattr(api.time, "sleep", lambda _s: None)
    assert api.lambda_runner([{"chunk": 1}]) == [{"chunk": 1}]
    assert fake.calls == 3


def test_full_concurrency_is_a_clear_503(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    from handlers import api
    monkeypatch.setattr(api, "_lambda", _FakeLambda(fail=10**6))
    monkeypatch.setattr(api, "RETRY_DEADLINE", 0.0)
    res = api.handler(_event("POST", "/api/simulate", {"runs": 2, "population": 2000, "days": 20}), None)
    assert res["statusCode"] == 503
    assert "mucha gente" in json.loads(res["body"])["error"]
=======
def test_a_body_that_is_not_utf8_is_a_400_not_a_crash(api):
    import base64
    event = {"requestContext": {"http": {"method": "POST"}}, "rawPath": "/api/parse",
             "body": base64.b64encode(b'{"text": "empieza en Montecrist' + bytes([0xF3]) + b'"}').decode(), "isBase64Encoded": True}
    assert api.handler(event, None)["statusCode"] == 400


def test_parse_and_news_routes(api):
    res = api.handler(_event("POST", "/api/parse", {"text": "la mitad de las vacunas", "current": {"doses_per_day": 20}}), None)
    assert res["statusCode"] == 200 and json.loads(res["body"])["changes"] == {"doses_per_day": 10}
    weeks = [{"week": 1, "zombies": 5, "bitten": 9, "vaccinated": 0, "barrios": ["Tarqui"]}]
    res = api.handler(_event("POST", "/api/news", {"weeks": weeks, "strategy": "degree"}), None)
    assert res["statusCode"] == 200 and len(json.loads(res["body"])["news"]) == 1
>>>>>>> Stashed changes
