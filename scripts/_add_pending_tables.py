#!/usr/bin/env python3
"""
One-shot: agrega tablas pendientes al SCHEMA_MANIFEST.json.
Idempotente: si ya existen no las duplica. Imprime las que va a agregar
y escribe el resultado a stdout o al path que se le pase como argv[1].
"""

import json
import sys
from pathlib import Path

MANIFEST = Path(__file__).parent.parent / "docs/master-plan/SCHEMA_MANIFEST.json"


def col_vc(name, mandatory=False, length=255, unique=False, indexed=False):
    c = {
        "column_name": name,
        "data_type": "varchar",
        "is_mandatory": "true" if mandatory else "false",
        "audit_consent": "false",
        "is_unique": "true" if unique else "false",
        "search_index_enabled": "true" if indexed else "false",
        "max_length": length,
    }
    return c


def col_text(name, mandatory=False):
    return {
        "column_name": name,
        "data_type": "text",
        "is_mandatory": "true" if mandatory else "false",
        "audit_consent": "false",
    }


def col_int(name, mandatory=False, indexed=False):
    return {
        "column_name": name,
        "data_type": "int",
        "is_mandatory": "true" if mandatory else "false",
        "audit_consent": "false",
        "is_unique": "false",
        "search_index_enabled": "true" if indexed else "false",
    }


def col_dt(name, mandatory=False, indexed=False):
    return {
        "column_name": name,
        "data_type": "datetime",
        "is_mandatory": "true" if mandatory else "false",
        "audit_consent": "false",
        "is_unique": "false",
        "search_index_enabled": "true" if indexed else "false",
    }


def col_bool(name, mandatory=False):
    return {
        "column_name": name,
        "data_type": "boolean",
        "is_mandatory": "true" if mandatory else "false",
        "audit_consent": "false",
    }


def col_double(name, mandatory=False):
    return {
        "column_name": name,
        "data_type": "double",
        "is_mandatory": "true" if mandatory else "false",
        "audit_consent": "false",
    }


# ===== Definiciones de tablas pendientes =====

NEW_TABLES = [
    {
        "name": "Alerts",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("severity", mandatory=True, length=20, indexed=True),
            col_vc("code", mandatory=True, length=100, indexed=True),
            col_vc("message", mandatory=True, length=500),
            col_text("context"),
            col_vc("tenant_id", length=50, indexed=True),
            col_vc("resource_type", length=50),
            col_vc("resource_id", length=50),
            col_vc("status", mandatory=True, length=20, indexed=True),
            col_int("occurrence_count", mandatory=True),
            col_dt("created_at", mandatory=True, indexed=True),
            col_dt("last_occurred_at", mandatory=True, indexed=True),
            col_dt("acknowledged_at"),
            col_vc("acknowledged_by", length=50),
            col_dt("resolved_at"),
        ],
    },
    {
        "name": "JobCosts",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("job_id", mandatory=True, length=50, indexed=True),
            col_vc("tenant_id", length=50, indexed=True),
            col_vc("cost_type", mandatory=True, length=20, indexed=True),
            col_double("amount_usd", mandatory=True),
            col_int("count", mandatory=True),
            col_dt("occurred_at", mandatory=True, indexed=True),
            col_vc("metadata", length=2000),
        ],
    },
    {
        "name": "EmailTemplateOverrides",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("tenant_id", length=50, indexed=True),
            col_vc("template_key", mandatory=True, length=100, indexed=True),
            col_vc("locale", mandatory=True, length=10),
            col_vc("subject", length=500),
            col_text("body_html"),
            col_text("body_text"),
            col_dt("created_at", mandatory=True),
            col_dt("updated_at", mandatory=True),
            col_vc("updated_by", length=50),
        ],
    },
    {
        "name": "SavedSearches",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("tenant_id", mandatory=True, length=50, indexed=True),
            col_vc("user_id", mandatory=True, length=100, indexed=True),
            col_vc("scope", mandatory=True, length=20, indexed=True),
            col_vc("name", mandatory=True, length=100),
            col_text("filters", mandatory=True),
            col_dt("created_at", mandatory=True),
            col_dt("updated_at", mandatory=True),
        ],
    },
    {
        "name": "UserFavorites",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("tenant_id", mandatory=True, length=50, indexed=True),
            col_vc("user_id", mandatory=True, length=100, indexed=True),
            col_vc("resource_type", mandatory=True, length=20, indexed=True),
            col_vc("resource_id", mandatory=True, length=50, indexed=True),
            col_vc("label", length=200),
            col_dt("created_at", mandatory=True),
        ],
    },
    {
        "name": "CandidateTags",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("tenant_id", mandatory=True, length=50, indexed=True),
            col_vc("candidate_id", mandatory=True, length=50, indexed=True),
            col_vc("tag", mandatory=True, length=50, indexed=True),
            col_vc("created_by", mandatory=True, length=100),
            col_dt("created_at", mandatory=True),
        ],
    },
    {
        "name": "CandidateNotes",
        "table_scope": "GLOBAL",
        "columns": [
            col_vc("tenant_id", mandatory=True, length=50, indexed=True),
            col_vc("application_id", mandatory=True, length=50, indexed=True),
            col_vc("author_id", mandatory=True, length=100),
            col_vc("author_name", length=255),
            col_text("body", mandatory=True),
            col_bool("is_pinned", mandatory=True),
            col_dt("created_at", mandatory=True, indexed=True),
            col_dt("updated_at", mandatory=True),
        ],
    },
]


def main():
    m = json.loads(MANIFEST.read_text())
    existing = {t["name"] for t in m["tables"]}
    to_add = [t for t in NEW_TABLES if t["name"] not in existing]
    already = [t["name"] for t in NEW_TABLES if t["name"] in existing]

    print(f"Manifest actual: {len(m['tables'])} tablas", file=sys.stderr)
    print(f"Ya existen (skip): {already}", file=sys.stderr)
    print(f"Van a agregarse: {[t['name'] for t in to_add]}", file=sys.stderr)

    m["tables"].extend(to_add)
    m["_generated_at"] = "2026-06-04"

    out_path = sys.argv[1] if len(sys.argv) > 1 else None
    output = json.dumps(m, indent=2, ensure_ascii=False)
    if out_path:
        Path(out_path).write_text(output)
        print(f"\nEscrito a {out_path}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
