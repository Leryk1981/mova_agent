-- Migration 0001: Initialize Tool Door D1 database

CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    ts INTEGER,
    verb TEXT,
    request_json TEXT,
    result_json TEXT,
    result_core_hash TEXT
);

CREATE TABLE policy_trail (
    id TEXT PRIMARY KEY,
    ts INTEGER,
    decisions_json TEXT
);

CREATE TABLE idempotency (
    key TEXT PRIMARY KEY,
    ts INTEGER,
    outcome_code TEXT,
    evidence_id TEXT,
    result_core_hash TEXT
);

CREATE TABLE throttle (
    key TEXT PRIMARY KEY,
    ts INTEGER
);