#!/usr/bin/env python3
"""
Process publicsuffix.org list into a JS module.

Usage (from repo root):
  curl -fsSL https://publicsuffix.org/list/public_suffix_list.dat -o scripts/psl.dat
  python3 scripts/build-psl.py

Output: lib/public-suffix-list.js exporting:
  - PSL_VERSION: string (date from the .dat header)
  - PSL_RULES: Set<string> containing all rules (including "*." wildcards and "!" exceptions)

All IDN labels are converted to Punycode (xn--...) form since URL().hostname returns Punycode.
ICANN + PRIVATE sections are merged — both behave as public suffixes for our
"registrable domain" computation, and we want operator-segmented hosts (github.io,
blogspot.com, etc.) treated as separate registrable units.
"""
import re

SRC = "scripts/psl.dat"
DST = "lib/public-suffix-list.js"

def encode_label(label):
    """Convert one DNS label to Punycode (a-label) if it has non-ASCII chars."""
    if all(ord(c) < 128 for c in label):
        return label
    # IDNA2003 via stdlib — sufficient for PSL entries which are all valid IDNs
    return label.encode("idna").decode("ascii")

def encode_rule(rule):
    """Encode each label of a dotted rule. Preserves !/*. prefix."""
    prefix = ""
    body = rule
    if body.startswith("!"):
        prefix = "!"
        body = body[1:]
    elif body.startswith("*."):
        prefix = "*."
        body = body[2:]
    parts = body.split(".")
    return prefix + ".".join(encode_label(p) for p in parts)

version = "unknown"
rules = set()
section = None

with open(SRC, "r", encoding="utf-8") as f:
    for raw in f:
        # Capture version line
        m = re.match(r"//\s*VERSION:\s*(\S+)", raw)
        if m:
            version = m.group(1)

        # Section markers (live in comments)
        if "BEGIN ICANN" in raw:
            section = "icann"; continue
        if "BEGIN PRIVATE" in raw:
            section = "private"; continue
        if "END ICANN" in raw or "END PRIVATE" in raw:
            section = None; continue

        # PSL parsing: only the first whitespace-delimited token counts; // is a comment
        line = raw.split("//", 1)[0].strip()
        if not line or section is None:
            continue

        try:
            rules.add(encode_rule(line.lower()))
        except UnicodeError as e:
            print(f"skip (encode failed): {line!r}: {e}")

sorted_rules = sorted(rules)
print(f"version: {version}")
print(f"rules: {len(sorted_rules)}")

# Emit JS module. We use a JSON array (smaller than `new Set([...])` source size,
# and the Set construction is the same at runtime).
with open(DST, "w", encoding="utf-8") as f:
    f.write("// AUTO-GENERATED from publicsuffix.org. Do not edit by hand.\n")
    f.write("// Regenerate with: python3 scripts/build-psl.py\n")
    f.write(f"// Source: https://publicsuffix.org/list/public_suffix_list.dat\n")
    f.write(f"// Snapshot: {version}\n")
    f.write("//\n")
    f.write("// Rules include both ICANN and PRIVATE sections, merged. All IDN labels\n")
    f.write("// are pre-converted to Punycode (xn--...) so they match URL().hostname.\n")
    f.write("// Prefixes:\n")
    f.write("//   *.foo   wildcard rule (one label + foo)\n")
    f.write("//   !foo    exception (foo is NOT a public suffix)\n")
    f.write("\n")
    f.write(f"export const PSL_VERSION = {version!r};\n\n")
    f.write("export const PSL_RULES = new Set([\n")
    # Pack 6 per line to keep file readable but compact
    PER_LINE = 6
    for i in range(0, len(sorted_rules), PER_LINE):
        chunk = sorted_rules[i:i+PER_LINE]
        f.write("  " + ", ".join(f'"{r}"' for r in chunk) + ",\n")
    f.write("]);\n")

import os
sz = os.path.getsize(DST)
print(f"wrote {DST}: {sz/1024:.1f} KB")
