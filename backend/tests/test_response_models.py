"""
Unit tests for app.models.response_models — APIResponse envelope.
"""
import pytest
from app.models.response_models import APIResponse


def test_ok_sets_success_true():
    r = APIResponse.ok(data={"key": "value"})
    assert r.success is True


def test_ok_data_preserved():
    r = APIResponse.ok(data={"stores": 200, "total_req": 1234.5})
    assert r.data["stores"] == 200
    assert r.data["total_req"] == pytest.approx(1234.5)


def test_ok_message_optional():
    r = APIResponse.ok(data={})
    assert r.message is None or r.message == ""


def test_ok_with_message():
    r = APIResponse.ok(data={}, message="Calculation started")
    assert r.message == "Calculation started"


def test_ok_errors_empty():
    r = APIResponse.ok(data={})
    assert r.errors == []


def test_fail_sets_success_false():
    r = APIResponse.fail(message="Something went wrong")
    assert r.success is False


def test_fail_message_preserved():
    r = APIResponse.fail(message="Factor set not found")
    assert r.message == "Factor set not found"


def test_fail_data_is_none():
    r = APIResponse.fail(message="Error")
    assert r.data is None


def test_fail_errors_list():
    r = APIResponse.fail(message="Validation failed", errors=["field_a required", "field_b invalid"])
    assert len(r.errors) == 2
    assert "field_a required" in r.errors


def test_fail_errors_default_empty():
    r = APIResponse.fail(message="Error")
    assert r.errors == []


def test_serialises_to_dict():
    r = APIResponse.ok(data={"x": 1}, message="ok")
    d = r.model_dump()
    assert d["success"] is True
    assert d["data"]["x"] == 1
    assert d["message"] == "ok"
