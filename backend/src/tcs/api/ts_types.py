"""Generate ``src/api/schema.ts`` (TypeScript interfaces) from the API's OpenAPI schemas.

``openapi-typescript`` needs TypeScript 5's compiler API, which the TypeScript 7
native compiler this repo uses does not ship, so this small, dependency-free
generator covers exactly the JSON-schema features our Pydantic models produce.
A test fails when the committed file is out of date (``npm run api:types``).
"""

from __future__ import annotations

from typing import Any, cast

HEADER = (
    "/**\n"
    " * GENERATED from the backend's OpenAPI schemas by `npm run api:types`. Do not edit.\n"
    " * Source: backend/src/tcs/api/schemas.py\n"
    " */\n"
)


def _ts(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return str(schema["$ref"]).rsplit("/", 1)[-1]
    if "const" in schema:
        return _literal(schema["const"])
    if "enum" in schema:
        return " | ".join(_literal(v) for v in schema["enum"])
    for key in ("anyOf", "oneOf"):
        if key in schema:
            return " | ".join(_ts(s) for s in schema[key])
    t = schema.get("type")
    if t == "array":
        if "prefixItems" in schema:
            return "[" + ", ".join(_ts(s) for s in schema["prefixItems"]) + "]"
        return f"{_wrap(_ts(schema.get('items', {})))}[]"
    if t == "object":
        extra = schema.get("additionalProperties")
        if isinstance(extra, dict):
            return f"Record<string, {_ts(cast(dict[str, Any], extra))}>"
        return "Record<string, unknown>"
    return {
        "string": "string",
        "integer": "number",
        "number": "number",
        "boolean": "boolean",
        "null": "null",
    }.get(str(t), "unknown")


def _wrap(t: str) -> str:
    return f"({t})" if " | " in t else t


def _literal(v: object) -> str:
    return f'"{v}"' if isinstance(v, str) else str(v).lower()


def generate(openapi: dict[str, Any]) -> str:
    schemas: dict[str, dict[str, Any]] = openapi["components"]["schemas"]
    out = [HEADER]
    for name in sorted(schemas):
        s = schemas[name]
        if s.get("type") != "object" or "properties" not in s:
            continue
        if name in ("HTTPValidationError", "ValidationError"):
            continue
        required = set(s.get("required", []))
        out.append(f"export interface {name} {{")
        for prop, ps in s["properties"].items():
            opt = "" if prop in required else "?"
            out.append(f"  {prop}{opt}: {_ts(ps)};")
        out.append("}\n")
    return "\n".join(out)
